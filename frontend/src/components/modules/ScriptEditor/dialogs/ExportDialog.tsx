'use client'

import { useState, useCallback } from 'react'
import { Button, Dialog } from '@omnistudio/ui'
import {
  FileText,
  FileCode,
  FileDown,
  Printer,
  FileSpreadsheet,
} from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { toFountain, toFDX, toPlainText } from './serializers'
import { scriptEditorApi } from '@/lib/scriptEditorApi'

export interface ExportDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  editor: Editor | null
}

interface FormatOption {
  id: string
  label?: string
  labelKey?: string
  descKey: string
  icon: React.ReactNode
  ext: string
  backend: boolean
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: 'fountain',
    label: 'Fountain',
    descKey: 'dialogs.export.fountainDesc',
    icon: <FileText size={20} className="text-primary" />,
    ext: '.fountain',
    backend: false,
  },
  {
    id: 'fdx',
    label: 'Final Draft (FDX)',
    descKey: 'dialogs.export.fdxDesc',
    icon: <FileCode size={20} className="text-primary" />,
    ext: '.fdx',
    backend: false,
  },
  {
    id: 'txt',
    labelKey: 'dialogs.export.txtLabel',
    descKey: 'dialogs.export.txtDesc',
    icon: <FileDown size={20} className="text-primary" />,
    ext: '.txt',
    backend: false,
  },
  {
    id: 'pdf',
    label: 'PDF',
    descKey: 'dialogs.export.pdfDesc',
    icon: <Printer size={20} className="text-primary" />,
    ext: '.pdf',
    backend: true,
  },
  {
    id: 'docx',
    label: 'DOCX',
    descKey: 'dialogs.export.docxDesc',
    icon: <FileSpreadsheet size={20} className="text-primary" />,
    ext: '.docx',
    backend: true,
  },
]

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

function downloadText(content: string, filename: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  downloadBlob(blob, filename)
}

export default function ExportDialog({ open, onClose, projectId, editor }: ExportDialogProps) {
  const t = useTranslations('scriptEditor')
  const tc = useTranslations('common')
  const [status, setStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle')
  const [activeFormat, setActiveFormat] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const handleClose = useCallback(() => {
    setStatus('idle')
    setActiveFormat(null)
    setErrorMsg('')
    onClose()
  }, [onClose])

  const handleExport = useCallback(
    async (format: FormatOption) => {
      if (!editor || status === 'exporting') return

      setActiveFormat(format.id)
      setStatus('exporting')
      setErrorMsg('')

      const doc = editor.getJSON()
      const filename = `script${format.ext}`

      try {
        if (!format.backend) {
          // Frontend serialization
          let content: string
          switch (format.id) {
            case 'fountain':
              content = toFountain(doc)
              break
            case 'fdx':
              content = toFDX(doc)
              downloadText(content, filename, 'application/xml')
              setStatus('success')
              handleClose()
              return
            case 'txt':
              content = toPlainText(doc)
              break
            default:
              content = toPlainText(doc)
          }
          downloadText(content, filename)
          setStatus('success')
          handleClose()
        } else {
          // Backend export (PDF/DOCX)
          const blob = await scriptEditorApi.exportDocument(projectId, doc, format.id)
          downloadBlob(blob, filename)
          setStatus('success')
          handleClose()
        }
      } catch (e: any) {
        setStatus('error')
        setErrorMsg(e?.response?.data?.detail || e?.message || t('dialogs.export.failed'))
      }
    },
    [editor, projectId, handleClose, status, t]
  )

  if (!open) return null

  return <Dialog isOpen={open} onOpenChange={isOpen => { if (!isOpen) handleClose(); }} isDismissable={status !== 'exporting'} title={t('dialogs.export.title')} closeLabel={tc('close')}>
    <div className="divide-y divide-border-subtle">
      {FORMAT_OPTIONS.map(format => <Button key={format.id} variant="quiet" isDisabled={!editor || status === 'exporting'} isPending={activeFormat === format.id && status === 'exporting'} className="h-auto w-full justify-start gap-3 rounded-none py-4 text-left whitespace-normal" onPress={() => handleExport(format)}>
        {format.icon}
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{format.labelKey ? t(format.labelKey) : format.label}</span><span className="mt-1 block text-xs font-normal text-text-muted">{t(format.descKey)}</span></span>
        <span className="font-mono text-xs text-text-muted">{format.ext}</span>
      </Button>)}
    </div>
    {status === 'error' && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{errorMsg}</p>}
  </Dialog>
}
