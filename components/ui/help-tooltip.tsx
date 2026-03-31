'use client'

import { HelpCircle } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface HelpTooltipProps {
  text: string
}

export function HelpTooltip({ text }: HelpTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center',
              cursor: 'help', flexShrink: 0,
            }}
          >
            <HelpCircle size={12} style={{ color: '#666666' }} />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          style={{
            background: '#181818',
            border: '0.5px solid #262626',
            borderRadius: 6,
            padding: '6px 10px',
            maxWidth: 240,
            fontSize: 11,
            color: '#a0a0a0',
            fontFamily: "'Inter', system-ui, sans-serif",
            lineHeight: 1.5,
          }}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
