'use client'

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import type { DerivedCharacter } from '@/store/editorStore'

export interface MentionListProps {
  items: DerivedCharacter[]
  command: (item: { id: string; label: string }) => void
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    // Reset selection when items change
    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) {
          command({ id: item.id, label: item.name })
        }
      },
      [items, command],
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) =>
            prev <= 0 ? items.length - 1 : prev - 1,
          )
          return true
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) =>
            prev >= items.length - 1 ? 0 : prev + 1,
          )
          return true
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }

        return false
      },
    }))

    if (!items.length) {
      return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 text-sm text-zinc-400">
          无匹配角色
        </div>
      )
    }

    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              index === selectedIndex
                ? 'bg-zinc-600 text-white'
                : 'text-zinc-300 hover:bg-zinc-700'
            }`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="font-medium">{item.name}</span>
            {item.occurrences > 0 && (
              <span className="ml-2 text-xs text-zinc-500">
                出场 {item.occurrences} 次
              </span>
            )}
          </button>
        ))}
      </div>
    )
  },
)

MentionList.displayName = 'MentionList'

export default MentionList
