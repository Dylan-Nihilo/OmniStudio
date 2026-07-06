import { Extension } from '@tiptap/core'

/**
 * Tab cycle order for screenplay node types.
 * Tab advances forward; Shift+Tab goes backward.
 */
const TAB_CYCLE = ['action', 'characterCue', 'dialogue', 'parenthetical'] as const

/**
 * Maps a node type to the node created when Enter is pressed.
 */
const ENTER_NEXT: Record<string, string> = {
  characterCue: 'dialogue',
  dialogue: 'action',
  parenthetical: 'dialogue',
  action: 'action',
  sceneHeading: 'action',
}

function getNodeNameAtCursor(editor: { state: { selection: { $from: { parent: { type: { name: string } } } } } }): string {
  return editor.state.selection.$from.parent.type.name
}

export const Keymap = Extension.create({
  name: 'scriptKeymap',

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const current = getNodeNameAtCursor(editor)
        const idx = TAB_CYCLE.indexOf(current as typeof TAB_CYCLE[number])
        if (idx === -1) {
          // Not in cycle — default to action
          return editor.commands.setNode('action')
        }
        const nextIdx = (idx + 1) % TAB_CYCLE.length
        const nextType = TAB_CYCLE[nextIdx]
        return editor.commands.setNode(nextType)
      },

      'Shift-Tab': ({ editor }) => {
        const current = getNodeNameAtCursor(editor)
        const idx = TAB_CYCLE.indexOf(current as typeof TAB_CYCLE[number])
        if (idx === -1) {
          return editor.commands.setNode('action')
        }
        const prevIdx = (idx - 1 + TAB_CYCLE.length) % TAB_CYCLE.length
        const prevType = TAB_CYCLE[prevIdx]
        return editor.commands.setNode(prevType)
      },

      Enter: ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection
        const currentNode = $from.parent
        const currentName = currentNode.type.name

        // Determine next node type based on current
        const nextType = ENTER_NEXT[currentName]

        if (!nextType) {
          // For unknown types or paragraph, default behavior
          return false
        }

        // Split current block and set new block type
        const endOfNode = $from.end()

        return editor
          .chain()
          .command(({ tr }) => {
            // Insert a new paragraph after current position, then convert
            tr.split(endOfNode)
            return true
          })
          .setNode(nextType)
          .run()
      },

      'Mod-Enter': ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection
        const endOfNode = $from.end()

        return editor
          .chain()
          .command(({ tr }) => {
            tr.split(endOfNode)
            return true
          })
          .setNode('sceneHeading')
          .run()
      },
    }
  },
})

export default Keymap
