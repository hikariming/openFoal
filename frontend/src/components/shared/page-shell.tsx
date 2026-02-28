import type { ReactNode } from 'react'
import { Typography } from '@douyinfe/semi-ui'

interface PageShellProps {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}

export function PageShell({ title, description, actions, children }: PageShellProps) {
  return (
    <section className="page-shell">
      <header className="page-shell__header">
        <div>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          <Typography.Text type="tertiary">{description}</Typography.Text>
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}
