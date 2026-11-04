/// The Lovart plugin's page in Settings: the person's Lovart keys, an access key and a secret key, checked before they
/// are kept (`POST /mode/query`, which changes nothing), Check and Forget once kept; and "Inspiration for design
/// meetings". Shaped as the Claude plugin's key card (lib/plugins/claude/claude_in_app.dart): Forget asks twice.
///
/// At its head, while the keys are missing, Set up (lovart_setup.dart, through lib/plugins/onboarding/setup_card.dart):
/// the steps from an account to keys that work; once they are kept, Run setup again.
///
/// The keys are kept in the device's secure store (manifest.dart) and follow the account sealed
/// (lib/sync/connections.dart); the page draws again when the plugin's storage or secrets change, so keys that arrive
/// from another device show as soon as they are read.
library;

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';

import '../../activity/activity_cost.dart' show askJobCost;
import '../../claude/claude_settings.dart' show maskKey;
import '../../art/art.dart';
import '../../settings/kit/settings_kit.dart';
import '../../settings/kit/settings_type.dart' show pageText;
import '../../settings/panes/pane_parts.dart' show armedFor;
import '../../settings/settings_search.dart' show SettingsFindable;
import '../github/plain_field.dart';
import '../host.dart' show onPluginStorage;
import '../onboarding/setup_card.dart';
import '../onboarding/setup_flow.dart' show PluginSetup;
import 'client.dart';
import 'lovart_mark.dart';
import 'manifest.dart';
import 'banner_run.dart' show BannerRun, bannerCandidates, bannerRunEstimate, bannerElsewhereWords, bannerRunEndWords, bannerRunLine, bannerRunMost, bannerTakenOff, lovartBannerJob, lovartBannerRun, runBanners, stopBannerRun;
import 'banners.dart' show BannerPreset, bannerNoteSlot, bannerPresetNow, bannerPresets, chooseBannerPreset, bannerStyleDefault, bannerTemplate, bannersOn, lovartExtra, setBannerTemplate, setBanners, setLovartExtra;
import 'lovart_queue.dart';
import 'models.dart' show LovartModel, lovartModel, lovartModels, setLovartModel;
import 'lovart_setup.dart';
import 'figma_refs.dart' show figmaRefsOn, setFigmaRefs;
import 'meetings.dart' show designMeetingsOn, setDesignMeetings;
import 'sketches.dart' show setSketchTemplate, setSketches, sketchStyleDefault, sketchSubjectSlot, sketchTemplate, sketchesOn;
import '../figma/frames.dart' show figmaFramesOn;

/// What Settings' search finds on the page.
const List<SettingsFindable> lovartFindable = [
  SettingsFindable('Lovart keys', 'access key secret key ak sk lovart api credits'),
  SettingsFindable('Header images for notes', 'banner header cover image painted illustration automatic'),
  SettingsFindable('Style', 'style painterly coloured colored pencil field journal sketch sepia ink ultra hd photo realistic preset swap header image'),
  SettingsFindable('Image model', 'image model generation midjourney nano banana gpt image seedream flux ideogram luma qwen'),
  SettingsFindable('Header image prompt', 'prompt style words banner header research assets edit change reset'),
  SettingsFindable('Added to every image', 'prompt extra words every image style always'),
  SettingsFindable('Queue', 'queue waiting making progress pictures header images credits'),
  SettingsFindable('Inspiration for design meetings', 'meetings design moodboard inspiration images automatic'),
  SettingsFindable('Field sketches', 'field sketch journal naturalist illustration enrich enrichment paragraphs margin specimen watercolor watercolour sepia automatic'),
  SettingsFindable('Sketch prompt', 'field sketch prompt style words subject edit change reset'),
  SettingsFindable('Use linked Figma frames', 'figma frames designs reference attachments header inspiration moodboard'),
];

/// What the run over the recent notes says: what it does, before one; how far it is while it runs, here or on
/// another of the account's devices; and how it ended.
/// Before a run, what Make them would cost (Matt, 2026-10-26: "Estimate about 6 credits per image for now"): "About
/// 600 credits for 100 notes", for the notes it would pick now, the ones taken off with them where [takenOff];
/// black-and-white and square ones to redo are read from their pictures as the run starts, and are on top.
String _runWords(BannerRun? run, {bool takenOff = false, bool redoOld = false}) {
  final job = lovartBannerJob;
  final count = job == null ? 0 : (bannerCandidates(job.notes()).length + (takenOff ? bannerTakenOff(job.notes()).length : 0)).clamp(0, bannerRunMost);
  final cost = count == 0 && !redoOld ? 'None of your recent notes is waiting for one now.' : '${aboutCredits(count).replaceFirst('a', 'A')} for ${count == 1 ? '1 note' : '$count notes'}${redoOld ? ', and about $lovartCreditsPerImage more for each header redone' : ''}.';
  final about = 'Banners for your $bannerRunMost most recent notes that are not tickets, meetings, mail or short, and have none yet. Three at a time, with your credits. They go on being made while you use the app. $cost';
  final elsewhere = lovartBannerJob?.elsewhere();
  if (run?.running != true && elsewhere != null) return bannerElsewhereWords(elsewhere);
  if (run == null) return about;
  if (run.running) return '${bannerRunLine(run)}. You can leave this page: they go on being made.';
  if (run.total == 0 && run.stopped != null) return run.stopped!;
  return '${bannerRunEndWords(run)}.';
}

class LovartPane extends StatefulWidget {
  const LovartPane({super.key});

  @override
  State<LovartPane> createState() => _LovartPaneState();
}

class _LovartPaneState extends State<LovartPane> {
  final TextEditingController _access = TextEditingController();
  final TextEditingController _secret = TextEditingController();

  /// "Header image prompt" and "Added to every image" (Matt, 2026-11-02: "allow a setting in the lovart plugin to
  /// modify the prompt"): the house's words to start from, kept with Keep, and Reset back to the house's.
  late final TextEditingController _prompt = TextEditingController(text: bannerTemplate() ?? bannerStyleDefault);
  late final TextEditingController _extra = TextEditingController(text: lovartExtra() ?? '');
  String? _promptSaid;
  late final TextEditingController _sketchPrompt = TextEditingController(text: sketchTemplate() ?? sketchStyleDefault);
  String? _sketchSaid;
  late final VoidCallback _stop;
  bool _checking = false;
  String? _problem;
  String? _said;
  bool _armed = false;

  /// The setup the head of the page opens (lovart_setup.dart).
  late final PluginSetup _setup = lovartSetup();

  /// Make them: a run over about 20 credits asks first, with what it should cost and take (docs/ACTIVITY.md, Cost:
  /// "12 banners · ~72 Lovart credits · ~4 min"); a smaller one just starts.
  Future<void> _makeThem() async {
    final job = lovartBannerJob;
    final count = job == null ? 0 : (bannerCandidates(job.notes()).length + (_takenOff ? bannerTakenOff(job.notes()).length : 0)).clamp(0, bannerRunMost);
    if (count > 0 && !await askJobCost(context, bannerRunEstimate(count), title: 'Make header images?')) return;
    await runBanners(takenOff: _takenOff, redoOld: _redoOld);
  }

  /// Make them's two choices, for the next run (Matt, 2026-10-26: "remove the header banner images on the docs as we
  /// will regenerate them"): the notes whose banner was taken off, and the black-and-white or square banners made again in
  /// colour. The page's own, never kept: each run is asked for as it is wanted.
  bool _takenOff = false;
  bool _redoOld = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _access.addListener(_redraw);
    _secret.addListener(_redraw);
    _prompt.addListener(_redraw);
    _extra.addListener(_redraw);
    _sketchPrompt.addListener(_redraw);
    _stop = onPluginStorage(_redraw);
    unawaited(host.secrets.warm());
  }

  @override
  void dispose() {
    _stop();
    _access.dispose();
    _secret.dispose();
    _prompt.dispose();
    _extra.dispose();
    _sketchPrompt.dispose();
    _timer?.cancel();
    super.dispose();
  }

  void _redraw() {
    if (mounted) setState(() {});
  }

  /// Whether the fields say something other than what is kept.
  bool get _promptChanged => _prompt.text.trim() != (bannerTemplate() ?? bannerStyleDefault).trim() || _extra.text.trim() != (lovartExtra() ?? '').trim();

  void _keepPrompt() {
    setBannerTemplate(_prompt.text);
    setLovartExtra(_extra.text);
    setState(() => _promptSaid = _prompt.text.contains(bannerNoteSlot) || _prompt.text.trim().isEmpty
        ? 'Kept. The next images are asked with these words.'
        : 'Kept. There is no $bannerNoteSlot in it, so the note goes at its end.');
  }

  /// Whether the sketch prompt's field says something other than what is kept.
  bool get _sketchChanged => _sketchPrompt.text.trim() != (sketchTemplate() ?? sketchStyleDefault).trim();

  void _keepSketchPrompt() {
    setSketchTemplate(_sketchPrompt.text);
    setState(() => _sketchSaid = 'Kept. The next sketches are asked with these words.');
  }

  void _resetSketchPrompt() {
    setSketchTemplate(null);
    _sketchPrompt.text = sketchStyleDefault;
    setState(() => _sketchSaid = 'Back to Ghost.md’s own words.');
  }

  void _choosePreset(BannerPreset preset) {
    chooseBannerPreset(preset);
    _prompt.text = preset.words;
    setState(() => _promptSaid = '${preset.name} chosen.');
  }

  /// Whether the list of models is open under the chosen one.
  bool _models = false;

  void _chooseModel(LovartModel? model) {
    setLovartModel(model);
    setState(() => _models = false);
  }

  /// Image model (Matt, 2026-11-04: "add the ability to change the image generation model on the lovart plugin"):
  /// the one chosen, and Change opening the list in place.
  Widget _modelSection() {
    final chosen = lovartModel();
    return PaneSection(
      title: 'Image model',
      description: const Text('Which model Lovart draws with, for header images, {image: …} and inspiration, on every device. Lovart takes it as a preference and may still pick another; a premium model can wait for your approval in Lovart.'),
      children: [
        SettingRow(
          key: const ValueKey('lovart-model'),
          label: chosen?.name ?? 'Let Lovart choose',
          hint: Text(chosen?.about ?? 'Lovart’s agent picks a model for each image.'),
          value: RowAction(onPress: () => setState(() => _models = !_models), child: Text(_models ? 'Done' : 'Change')),
        ),
        if (_models) ...[
          SettingRow(
            key: const ValueKey('lovart-model:auto'),
            label: 'Let Lovart choose',
            hint: const Text('Lovart’s agent picks a model for each image.'),
            control: Pick(checked: chosen == null, label: 'Let Lovart choose', onPress: () => _chooseModel(null)),
          ),
          for (final model in lovartModels)
            SettingRow(
              key: ValueKey('lovart-model:${model.id}'),
              label: model.name,
              hint: Text(model.about),
              control: Pick(checked: chosen?.id == model.id, label: 'Use ${model.name}', onPress: () => _chooseModel(model)),
            ),
        ],
      ],
    );
  }

  void _resetPrompt() {
    setBannerTemplate(null);
    _prompt.text = bannerStyleDefault;
    setState(() => _promptSaid = 'Back to Ghost.md’s own words.');
  }

  Future<void> _keep() async {
    final access = _access.text.trim(), secret = _secret.text.trim();
    if (access.isEmpty || secret.isEmpty || _checking) return;
    setState(() {
      _checking = true;
      _problem = null;
      _said = null;
    });
    final wrong = await LovartClient(accessKey: access, secretKey: secret).check();
    if (!mounted) return;
    if (wrong != null && wrong.badKeys) {
      setState(() {
        _checking = false;
        _problem = 'Lovart refused those keys. Copy both again from Lovart Agent › OpenClaw in Lovart.';
      });
      return;
    }
    await host.secrets.write(accessKeySecret, access);
    await host.secrets.write(secretKeySecret, secret);
    if (!mounted) return;
    _access.clear();
    _secret.clear();
    setState(() {
      _checking = false;
      // Kept even when they could not be checked (no connection): the first image says if they are wrong.
      _said = wrong == null ? 'The keys work.' : 'Kept. They could not be checked just now: ${wrong.message}';
    });
  }

  Future<void> _check() async {
    final lovart = LovartClient.kept();
    if (lovart == null || _checking) return;
    setState(() {
      _checking = true;
      _problem = null;
      _said = null;
    });
    final wrong = await lovart.check();
    if (!mounted) return;
    setState(() {
      _checking = false;
      if (wrong == null) {
        _said = 'The keys work.';
      } else {
        _problem = wrong.message;
      }
    });
  }

  void _forget() {
    _timer?.cancel();
    if (!_armed) {
      setState(() => _armed = true);
      HapticsProvider.of(context)(HapticKind.warning);
      _timer = Timer(armedFor, () {
        if (mounted) setState(() => _armed = false);
      });
      return;
    }
    setState(() {
      _armed = false;
      _said = null;
      _problem = null;
    });
    unawaited(host.secrets.write(accessKeySecret, null));
    unawaited(host.secrets.write(secretKeySecret, null));
    host.storage.remove(projectKey);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final keys = lovartKeys();
    final ready = _access.text.trim().isNotEmpty && _secret.text.trim().isNotEmpty;
    return PaneBody(
      children: [
        PluginSetupCard(setup: _setup),
        if (_problem != null) SettingsCallout(child: Text(_problem!)),
        if (_said != null) SettingsCallout(child: Text(_said!)),
        PaneSection(
          title: 'Style',
          description: const Text('How header images are drawn. Choosing one puts its words in the header image prompt below, where you can still change them.'),
          children: [_StylePicker(chosen: bannerPresetNow(), onChoose: _choosePreset)],
        ),
        _modelSection(),
        PaneSection(
          title: 'Lovart keys',
          description: const Text('Lovart makes the images with its design agent, using your own Lovart account: in Lovart, click your profile, then Lovart Agent › OpenClaw, and copy the two keys. Each image is made with your Lovart credits.'),
          footer: const Text('The keys are kept in this device’s secure storage and follow your account, sealed, to your other devices.'),
          children: [
            if (keys == null)
              SettingRow(
                key: const ValueKey('lovart-keys-new'),
                icon: const LovartMark(size: 18),
                label: 'Access key and secret key',
                layout: SettingRowLayout.stacked,
                control: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  spacing: t.space(2),
                  children: [
                    PlainField(key: const ValueKey('lovart-access'), label: 'Lovart access key', controller: _access, placeholder: 'Access key', secret: true),
                    PlainField(key: const ValueKey('lovart-secret'), label: 'Lovart secret key', controller: _secret, placeholder: 'Secret key', secret: true, onSubmitted: _keep),
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: RowAction(onPress: _keep, disabled: _checking || !ready, child: Text(_checking ? 'Checking…' : 'Keep them')),
                    ),
                  ],
                ),
              )
            else ...[
              SettingRow(
                key: const ValueKey('lovart-keys-kept'),
                icon: const LovartMark(size: 18),
                label: 'Keys kept',
                hint: Text('Access key ${maskKey(keys.access)}'),
                value: RowAction(onPress: _check, disabled: _checking, child: Text(_checking ? 'Checking…' : 'Check')),
              ),
              SettingRow(
                key: const ValueKey('lovart-keys-forget'),
                label: 'Forget the keys',
                hint: const Text('Lovart can no longer be asked from this device until they are added again.'),
                value: RowAction(onPress: _forget, child: Text(_armed ? 'Tap again' : 'Forget')),
              ),
            ],
          ],
        ),
        PaneSection(
          title: 'Notes',
          children: [
            SettingRow(
              key: const ValueKey('lovart-banners'),
              label: 'Header images for notes',
              hint: const Text('When you leave a note, Lovart looks up what it is about and draws a banner for its top in the style of the prompt below, from its title, sections and opening. Once per note, with your credits; not for tickets, meetings, mail or short notes. Make one any time from Header image on the note’s menu.'),
              control: GlacierSwitch(ariaLabel: 'Header images for notes', checked: bannersOn(), onCheckedChange: setBanners),
            ),
            if (lovartBannerJob != null)
              ValueListenableBuilder<BannerRun?>(
                valueListenable: lovartBannerRun,
                builder: (context, run, _) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SettingRow(
                      key: const ValueKey('lovart-banner-run'),
                      label: 'Header images for recent notes',
                      hint: Text(_runWords(run, takenOff: _takenOff, redoOld: _redoOld)),
                      value: run?.running == true
                          ? RowAction(onPress: stopBannerRun, child: const Text('Stop'))
                          : RowAction(onPress: () => unawaited(_makeThem()), disabled: keys == null, child: const Text('Make them')),
                    ),
                    if (run?.running != true) ...[
                      SettingRow(
                        key: const ValueKey('lovart-banner-taken-off'),
                        label: 'Include notes whose header was taken off',
                        hint: const Text('Makes them again for notes that had one. Leaving a note never does.'),
                        control: GlacierSwitch(ariaLabel: 'Include notes whose header was taken off', checked: _takenOff, onCheckedChange: (on) => setState(() => _takenOff = on)),
                      ),
                      SettingRow(
                        key: const ValueKey('lovart-banner-redo'),
                        label: 'Redo black-and-white and square headers',
                        hint: const Text('The banners made before they were in colour and wide, made again and put in their place.'),
                        control: GlacierSwitch(ariaLabel: 'Redo black-and-white and square headers', checked: _redoOld, onCheckedChange: (on) => setState(() => _redoOld = on)),
                      ),
                    ],
                  ],
                ),
              ),
          ],
        ),
        PaneSection(
          title: 'Prompt',
          description: const Text('What Lovart is asked, on every device you sign in on. The header image prompt has $bannerNoteSlot where the note goes: its title, sections and opening, for Lovart to look up and draw.'),
          children: [
            SettingRow(
              key: const ValueKey('lovart-prompt'),
              label: 'Header image prompt',
              layout: SettingRowLayout.stacked,
              control: _PromptField(key: const ValueKey('lovart-prompt-field'), label: 'Header image prompt', controller: _prompt, placeholder: bannerStyleDefault, lines: 8),
            ),
            SettingRow(
              key: const ValueKey('lovart-extra'),
              label: 'Added to every image',
              hint: const Text('Words put at the end of every image asked for: header images, {image: …} and inspiration. “Muted autumn colours”, “no people”.'),
              layout: SettingRowLayout.stacked,
              control: _PromptField(key: const ValueKey('lovart-extra-field'), label: 'Added to every image', controller: _extra, placeholder: 'Nothing added', lines: 2),
            ),
            SettingRow(
              key: const ValueKey('lovart-prompt-actions'),
              label: _promptSaid ?? (_promptChanged ? 'Not kept yet' : (bannerTemplate() == null ? 'Ghost.md’s own words' : 'Your own words')),
              layout: SettingRowLayout.stacked,
              control: Wrap(
                alignment: WrapAlignment.end,
                spacing: context.tokens.space(2),
                runSpacing: context.tokens.space(2),
                children: [
                  RowAction(onPress: _resetPrompt, disabled: bannerTemplate() == null && _prompt.text.trim() == bannerStyleDefault.trim(), child: const Text('Reset')),
                  RowAction(onPress: _keepPrompt, disabled: !_promptChanged, child: const Text('Keep')),
                ],
              ),
            ),
          ],
        ),
        // Field sketches (sketches.dart; Kevin, 2026-11-04): off until switched on, since a note can take several.
        PaneSection(
          title: 'Field sketches',
          description: const Text('Small field-journal drawings beside the paragraphs they belong to: Lovart reads each one, picks the one thing it is about and draws it in sepia ink and watercolour, so the note reads like an explorer’s sketchbook.'),
          children: [
            SettingRow(
              key: const ValueKey('lovart-sketches'),
              label: 'Field sketches',
              hint: const Text('When you leave a note of a few paragraphs, Lovart sketches up to four of its longest, one a section, spaced apart and never beside a picture already there. Once per note, with your credits; not for tickets, meetings, mail or short notes. Add them any time from Add field sketches on the note’s menu.'),
              control: GlacierSwitch(ariaLabel: 'Field sketches', checked: sketchesOn(), onCheckedChange: (on) => setState(() => setSketches(on))),
            ),
            SettingRow(
              key: const ValueKey('lovart-sketch-prompt'),
              label: 'Sketch prompt',
              hint: const Text('$sketchSubjectSlot is the thing Lovart chooses to draw; the paragraph goes after these words.'),
              layout: SettingRowLayout.stacked,
              control: _PromptField(key: const ValueKey('lovart-sketch-prompt-field'), label: 'Sketch prompt', controller: _sketchPrompt, placeholder: sketchStyleDefault, lines: 8),
            ),
            SettingRow(
              key: const ValueKey('lovart-sketch-prompt-actions'),
              label: _sketchSaid ?? (_sketchChanged ? 'Not kept yet' : (sketchTemplate() == null ? 'Ghost.md’s own words' : 'Your own words')),
              layout: SettingRowLayout.stacked,
              control: Wrap(
                alignment: WrapAlignment.end,
                spacing: context.tokens.space(2),
                runSpacing: context.tokens.space(2),
                children: [
                  RowAction(onPress: _resetSketchPrompt, disabled: sketchTemplate() == null && _sketchPrompt.text.trim() == sketchStyleDefault.trim(), child: const Text('Reset')),
                  RowAction(onPress: _keepSketchPrompt, disabled: !_sketchChanged, child: const Text('Keep')),
                ],
              ),
            ),
          ],
        ),
        // What is being made now and what waits, on this device (lovart_queue.dart).
        const LovartQueueSection(),
        PaneSection(
          title: 'Meetings',
          children: [
            SettingRow(
              key: const ValueKey('lovart-design-meetings'),
              label: 'Inspiration for design meetings',
              hint: const Text('Once a meeting about design is written up (mockups, branding, a layout, a logo), Lovart makes a moodboard of four from its summary, under Inspiration in the note. Once per meeting, with your credits.'),
              control: GlacierSwitch(ariaLabel: 'Inspiration for design meetings', checked: designMeetingsOn(), onCheckedChange: setDesignMeetings),
            ),
          ],
        ),
        // A note's Figma frames as references (figma_refs.dart): off until switched on, since the designs go to Lovart.
        PaneSection(
          title: 'Figma',
          children: [
            SettingRow(
              key: const ValueKey('lovart-figma-refs'),
              label: 'Use linked Figma frames',
              hint: Text(figmaFramesOn()
                  ? 'A note’s header image and its inspiration start from the Figma frames it links to: up to three are sent to Lovart as references, their palette and subject drawn in the image. Their pictures go to Lovart, so leave this off for designs that must stay private.'
                  : 'Needs the Figma plugin, added in the Market and connected with your Figma token. Then a note’s header image and its inspiration start from the Figma frames it links to.'),
              control: GlacierSwitch(ariaLabel: 'Use linked Figma frames', checked: figmaRefsOn(), onCheckedChange: (on) => setState(() => setFigmaRefs(on))),
            ),
          ],
        ),
        const SettingsFootnote(child: Text('Only the words of a {image: …}, the note you ask inspiration for, a note’s title, sections and opening for its header image, or a paragraph for its field sketch go to Lovart, with your prompt’s words, and the pictures of a note’s Figma frames where Use linked Figma frames is on. Lovart’s agent may search the web for what they name. Write {image: a prompt} anywhere in a note to make a picture there.')),
      ],
    );
  }
}


/// A prompt's words: a field of several lines that grows with them, Enter a new line, nothing corrected, since what
/// is typed is sent to Lovart as it is (the snippets page's field, lib/settings/panes/snippets_pane.dart).
/// The styles as cards with a sample each, two or four across as the page allows; the one the prompt holds is marked.
class _StylePicker extends StatelessWidget {
  const _StylePicker({required this.chosen, required this.onChoose});

  final BannerPreset? chosen;
  final ValueChanged<BannerPreset> onChoose;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final gap = t.space(2);
    return Padding(
      padding: EdgeInsets.all(t.space(3)),
      child: LayoutBuilder(
        builder: (context, box) {
          final across = box.maxWidth >= 560 ? 4 : 2;
          final width = (box.maxWidth - gap * (across - 1)) / across;
          return Wrap(
            spacing: gap,
            runSpacing: gap,
            children: [
              for (final preset in bannerPresets)
                SizedBox(width: width, child: _StyleCard(key: ValueKey('lovart-style-${preset.id}'), preset: preset, chosen: chosen?.id == preset.id, onPress: () => onChoose(preset))),
            ],
          );
        },
      ),
    );
  }
}

class _StyleCard extends StatelessWidget {
  const _StyleCard({super.key, required this.preset, required this.chosen, required this.onPress});

  final BannerPreset preset;
  final bool chosen;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final ink = t.color('app-ink');
    final muted = t.color('glacier-text-muted');
    final accent = t.color('glacier-accent-solid');
    final radius = t.radius('lg');
    return Semantics(
      selected: chosen,
      child: GlacierPressable(
        onPressed: onPress,
        semanticLabel: '${preset.name}, ${preset.blurb}',
        builder: (context, state) => GlacierFocusRing(
          visible: state.focused,
          radius: radius,
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: Color.alphaBlend(ink.withValues(alpha: state.pressed ? 0.08 : 0.04), t.color('glacier-bg')),
              borderRadius: BorderRadius.circular(radius),
              border: Border.all(color: chosen ? accent : t.colorOf('color-mix(in oklch, var(--app-ink) 10%, transparent)'), width: chosen ? 2 : t.len('glacier-hairline')),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                AspectRatio(
                  aspectRatio: 16 / 9,
                  child: Image.asset(
                    preset.sample,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stack) => ColoredBox(color: ink.withValues(alpha: 0.06), child: Center(child: AppIcon(Lucide.image, size: 20, color: muted))),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.all(t.space(2)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(preset.name, style: pageText(t, t.fontSize('sm'), weight: 'semibold'), maxLines: 1, overflow: TextOverflow.ellipsis)),
                          if (chosen) AppIcon(Lucide.check, size: 16, color: accent),
                        ],
                      ),
                      Text(preset.blurb, style: pageText(t, t.fontSize('xs'), color: muted), maxLines: 2, overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PromptField extends StatefulWidget {
  const _PromptField({super.key, required this.label, required this.controller, required this.placeholder, this.lines = 3});

  final String label;
  final TextEditingController controller;
  final String placeholder;
  final int lines;

  @override
  State<_PromptField> createState() => _PromptFieldState();
}

class _PromptFieldState extends State<_PromptField> {
  final FocusNode _focus = FocusNode(debugLabel: 'lovart prompt');

  @override
  void initState() {
    super.initState();
    _focus.addListener(_changed);
  }

  @override
  void dispose() {
    _focus
      ..removeListener(_changed)
      ..dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final ink = t.color('app-ink');
    final quiet = t.color('app-ink-3');
    final style = pageText(t, t.fontSize('sm'), color: ink);
    return GlacierFocusRing(
      visible: _focus.hasFocus,
      offset: 1,
      radius: t.radius('md'),
      color: t.color('glacier-accent-solid'),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _focus.requestFocus,
        child: DecoratedBox(
          decoration: BoxDecoration(color: ink.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(t.radius('md'))),
          child: Padding(
            padding: EdgeInsets.all(t.space(3)),
            child: Stack(
              children: [
                if (widget.controller.text.isEmpty) ExcludeSemantics(child: Text(widget.placeholder, style: style.copyWith(color: quiet), maxLines: widget.lines, overflow: TextOverflow.ellipsis)),
                Semantics(
                  label: widget.label,
                  textField: true,
                  child: EditableText(
                    controller: widget.controller,
                    focusNode: _focus,
                    style: style,
                    cursorColor: ink,
                    cursorWidth: 1,
                    backgroundCursorColor: quiet,
                    selectionColor: t.color('glacier-selection'),
                    minLines: widget.lines,
                    maxLines: null,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    textCapitalization: TextCapitalization.sentences,
                    autocorrect: false,
                    enableSuggestions: false,
                    smartDashesType: SmartDashesType.disabled,
                    smartQuotesType: SmartQuotesType.disabled,
                    keyboardAppearance: t.isDark ? Brightness.dark : Brightness.light,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
