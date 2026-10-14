import { StrokeMark } from '../kit.tsx';

/**
 * A branch: a repo, in the app's strokes. Two whole rings (each drawn as two half arcs, since one arc can't close on
 * itself) and a line, with the branch curving from the bottom of the right ring onto the left one. The first version
 * left its curve hanging below the right ring and ran it into the left one (Matt: "git icon is messed up").
 */
export function RepoMark({ size }: { size?: number }) {
  return <StrokeMark d="M6 3v12M18 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6M18 9a9 9 0 0 1-9 9" size={size} />;
}
