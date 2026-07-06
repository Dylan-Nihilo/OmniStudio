import { SceneHeading } from './SceneHeading'
import { Action } from './Action'
import { CharacterCue } from './CharacterCue'
import { Dialogue } from './Dialogue'
import { Transition } from './Transition'

export { SceneHeading } from './SceneHeading'
export { Action } from './Action'
export { CharacterCue } from './CharacterCue'
export { Dialogue } from './Dialogue'
export { Transition } from './Transition'

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
]
