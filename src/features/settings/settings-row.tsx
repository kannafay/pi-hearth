import type { ReactNode } from 'react'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'

export function SettingsRow({
  title,
  description,
  control,
  value,
  children,
  htmlFor,
  titleId,
  descriptionId,
}: {
  title: string
  description?: ReactNode
  control?: ReactNode
  value?: string
  children?: ReactNode
  htmlFor?: string
  titleId?: string
  descriptionId?: string
}) {
  return (
    <div data-slot="settings-row" className="space-y-4 border-b py-5">
      <Field orientation="horizontal" className="items-center gap-5">
        <FieldContent>
          {htmlFor ? (
            <FieldLabel id={titleId} htmlFor={htmlFor}>
              {title}
            </FieldLabel>
          ) : (
            <FieldTitle id={titleId} role="heading" aria-level={3}>
              {title}
            </FieldTitle>
          )}
          {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
        </FieldContent>
        {control ? (
          <div className="shrink-0">{control}</div>
        ) : value != null ? (
          <span className="shrink-0 text-sm text-muted-foreground">{value}</span>
        ) : null}
      </Field>
      {children}
    </div>
  )
}
