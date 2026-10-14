//! Who may ask, and how often.
//!
//! The box behind this endpoint is not Glyph's. It serves AttackFM, its
//! review server, the registry and PrettyCardboard, and the Ollama this
//! service borrows is the one AttackFM's enrichment and DJ run on. So the
//! question this module answers is less "is this Matt" than "can anything
//! reaching this URL take enough of that Ollama to be noticed".
//!
//! THE TOKEN IS A SPEED BUMP, NOT A SECRET. It ships inside the public APK at
//! attack.fm/glyph/glyph.apk, where `unzip` and `strings` find it in a minute.
//! It keeps out a crawler that finds the path and nobody who wants in. The
//! real protection is the shape of the service itself: a per-address rate
//! limit and a breaker here, a body cap and ONE concurrent model call in
//! `main.rs`, the admission gate in `model.rs`, and a bind to loopback so Caddy
//! is the only door.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// Whether an `Authorization` header carries exactly this bearer token.
///
/// Compared in constant time. With the token in a public APK that is not
/// protecting much, but a comparison that returns at the first wrong byte is
/// a timing oracle for whatever token replaces it, and doing it properly
/// costs nothing.
pub fn bearer_matches(header: Option<&str>, token: &str) -> bool {
    let Some(presented) = header.and_then(|h| h.strip_prefix("Bearer ")) else {
        return false;
    };
    constant_time_eq(presented.trim().as_bytes(), token.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The address a request really came from.
///
/// The service binds to 127.0.0.1, so every peer it sees is Caddy. Caddy's
/// `reverse_proxy` sets `X-Forwarded-For` to the client it accepted, and by
/// default REPLACES whatever the client claimed rather than appending to it,
/// so the header is one address. The LAST entry is taken anyway: if a trusted
/// proxy is ever added in front, the rightmost address is still the one Caddy
/// wrote, and the leftmost is still whatever the client typed.
///
/// The header is only believed from a loopback peer. Anything else reaching
/// this socket is not Caddy, and gets limited by the address it really has.
pub fn client_ip(peer: IpAddr, forwarded_for: Option<&str>) -> IpAddr {
    if !peer.is_loopback() {
        return peer;
    }
    forwarded_for
        .and_then(|h| h.rsplit(',').next())
        .and_then(|last| last.trim().parse().ok())
        .unwrap_or(peer)
}

/// A token bucket per client address.
///
/// A bucket rather than a fixed window because the phone's traffic is bursty
/// by nature: Matt pauses, the phone sends, he carries on and pauses again. A
/// window resetting on the minute lets forty requests through across its edge;
/// a bucket holds the same average and never more than `capacity` in a row.
pub struct RateLimiter<K = IpAddr> {
    buckets: HashMap<K, Bucket>,
    capacity: f64,
    per_second: f64,
    last_prune: Instant,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

/// How long an address may go unseen before its bucket is forgotten. A bucket
/// untouched this long is full again anyway, so forgetting it changes nothing.
const FORGET_AFTER: Duration = Duration::from_secs(600);

/// Keyed by anything, not only an address: sign-in is also limited per handle (src/accounts.rs), so a guesser
/// spreading attempts across many addresses still meets one bucket per account.
impl<K: Eq + std::hash::Hash> RateLimiter<K> {
    pub fn new(per_minute: u32, now: Instant) -> Self {
        Self {
            buckets: HashMap::new(),
            capacity: f64::from(per_minute),
            per_second: f64::from(per_minute) / 60.0,
            last_prune: now,
        }
    }

    /// Spend one request for `ip`, if it has one left.
    pub fn take(&mut self, ip: K, now: Instant) -> bool {
        if now.duration_since(self.last_prune) > FORGET_AFTER {
            self.buckets.retain(|_, b| now.duration_since(b.last) < FORGET_AFTER);
            self.last_prune = now;
        }
        let bucket = self.buckets.entry(ip).or_insert(Bucket { tokens: self.capacity, last: now });
        let refill = now.duration_since(bucket.last).as_secs_f64() * self.per_second;
        bucket.tokens = (bucket.tokens + refill).min(self.capacity);
        bucket.last = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    #[cfg(test)]
    fn tracked(&self) -> usize {
        self.buckets.len()
    }
}

/// Stops calling the model for a while after a call that could not finish.
///
/// MEASURED on the box (2026-09-12, qwen3.5:9b, 198-word note): once a call is
/// admitted, generating its 263 tokens of annotations took 57 to 64 seconds.
/// The whole budget is 45. So on a CPU that busy an admitted call does not
/// produce a late answer - it produces NO answer, after holding AttackFM's only
/// slot until the budget runs out and the call is cancelled. The admission gate
/// cannot see that coming; it only knows the call was admitted.
///
/// So one overrun opens this, and while it is open the endpoint answers 503 at
/// once without asking Ollama anything. The worst a phone can then cost
/// AttackFM is one wasted slot-hold per cooldown, however long Matt dictates.
/// A refusal at the admission gate does NOT open it: that call never ran, so
/// it cost nothing and says nothing about whether the next one could finish.
/// When the box is quiet enough - or the model is changed for one that fits -
/// the first call after the cooldown succeeds and nothing stays open.
pub struct Breaker {
    open_until: Option<Instant>,
    cooldown: Duration,
}

impl Breaker {
    pub fn new(cooldown: Duration) -> Self {
        Self { open_until: None, cooldown }
    }

    pub fn is_open(&self, now: Instant) -> bool {
        self.open_until.is_some_and(|until| now < until)
    }

    /// An admitted call ran out of budget.
    pub fn overran(&mut self, now: Instant) {
        self.open_until = Some(now + self.cooldown);
    }

    /// How long until the model is asked again, for the error message.
    pub fn remaining(&self, now: Instant) -> Duration {
        self.open_until.map(|until| until.saturating_duration_since(now)).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn only_the_exact_bearer_token_passes() {
        assert!(bearer_matches(Some(&format!("Bearer {TOKEN}")), TOKEN));
        assert!(!bearer_matches(None, TOKEN), "no header");
        assert!(!bearer_matches(Some(TOKEN), TOKEN), "no scheme");
        assert!(!bearer_matches(Some(&format!("Basic {TOKEN}")), TOKEN), "wrong scheme");
        assert!(!bearer_matches(Some(&format!("Bearer {}", &TOKEN[1..])), TOKEN), "one short");
        assert!(!bearer_matches(Some(&format!("Bearer {TOKEN}0")), TOKEN), "one long");
        assert!(!bearer_matches(Some("Bearer "), TOKEN), "empty");
    }

    #[test]
    fn trusts_forwarded_for_only_from_caddy() {
        let caddy: IpAddr = "127.0.0.1".parse().unwrap();
        let phone: IpAddr = "203.0.113.9".parse().unwrap();
        assert_eq!(client_ip(caddy, Some("203.0.113.9")), phone);
        assert_eq!(client_ip(caddy, Some("198.51.100.1, 203.0.113.9")), phone, "the rightmost is the one Caddy wrote");
        assert_eq!(client_ip(caddy, None), caddy);
        assert_eq!(client_ip(caddy, Some("not an address")), caddy);
        let stranger: IpAddr = "198.51.100.7".parse().unwrap();
        assert_eq!(client_ip(stranger, Some("203.0.113.9")), stranger, "a non-loopback peer cannot claim an address");
    }

    #[test]
    fn allows_a_burst_of_twenty_then_refuses_until_it_refills() {
        let start = Instant::now();
        let ip: IpAddr = "203.0.113.9".parse().unwrap();
        let mut limiter = RateLimiter::<IpAddr>::new(20, start);
        for i in 0..20 {
            assert!(limiter.take(ip, start), "request {i} of the burst");
        }
        assert!(!limiter.take(ip, start), "the twenty-first in the same instant");
        assert!(!limiter.take(ip, start + Duration::from_secs(2)), "two seconds buys less than one");
        assert!(limiter.take(ip, start + Duration::from_secs(3)), "three seconds buys exactly one");
        assert!(!limiter.take(ip, start + Duration::from_secs(3)));

        let other: IpAddr = "198.51.100.1".parse().unwrap();
        assert!(limiter.take(other, start), "one address's burst is not another's");
    }

    #[test]
    fn the_breaker_stays_shut_until_an_overrun_and_reopens_after_the_cooldown() {
        let start = Instant::now();
        let mut breaker = Breaker::new(Duration::from_secs(600));
        assert!(!breaker.is_open(start), "a fresh service asks the model");
        breaker.overran(start);
        assert!(breaker.is_open(start + Duration::from_secs(599)));
        assert_eq!(breaker.remaining(start + Duration::from_secs(100)), Duration::from_secs(500));
        assert!(!breaker.is_open(start + Duration::from_secs(600)), "and asks again after the cooldown");
    }

    #[test]
    fn forgets_addresses_it_has_not_seen_for_ten_minutes() {
        let start = Instant::now();
        let mut limiter = RateLimiter::<IpAddr>::new(20, start);
        limiter.take("203.0.113.9".parse().unwrap(), start);
        limiter.take("198.51.100.1".parse().unwrap(), start + Duration::from_secs(700));
        assert_eq!(limiter.tracked(), 1);
    }
}
