import { SceneHeading } from './SceneHeading'
import { Action } from './Action'
import { CharacterCue } from './CharacterCue'
import { Dialogue } from './Dialogue'
import { Transition } from './Transition'
import { Parenthetical } from './Parenthetical'
import { DualDialogue, DialogueColumn } from './DualDialogue'
import { Note } from './Note'
import { Section } from './Section'
import { Keymap } from './Keymap'

export { SceneHeading } from './SceneHeading'
export { Action } from './Action'
export { CharacterCue } from './CharacterCue'
export { Dialogue } from './Dialogue'
export { Transition } from './Transition'
export { Parenthetical } from './Parenthetical'
export { DualDialogue, DialogueColumn } from './DualDialogue'
export { Note } from './Note'
export { Section } from './Section'
export { Keymap } from './Keymap'

/**
 * All script editor node extensions bundled for one-shot registration.
 * Usage: useEditorSetup({ extensions: [...scriptExtensions, ...otherExtensions] })
 */
export const scriptExtensions = [
  SceneHeading,
  Action,
  CharacterCue,
  Dialogue,
  Transition,
  Parenthetical,
  DualDialogue,
  DialogueColumn,
  Note,
  Section,
  Keymap,
]
