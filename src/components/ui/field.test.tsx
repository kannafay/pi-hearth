import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Button } from './button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './field'
import { Input } from './input'

test('shared dialog fields keep labels, descriptions, validation and Enter submission connected', async () => {
  const saved = vi.fn()
  function Form() {
    const [name, setName] = useState('')
    const [error, setError] = useState('')
    return (
      <Dialog open>
        <DialogContent size="sm" showCloseButton={false}>
          <DialogHeader variant="compact">
            <DialogTitle>编辑名称</DialogTitle>
            <DialogDescription>保存可识别的名称。</DialogDescription>
          </DialogHeader>
          <DialogForm
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) setError('请输入名称')
              else saved(name)
            }}
          >
            <DialogBody>
              <FieldGroup>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="shared-name">名称</FieldLabel>
                  <Input
                    id="shared-name"
                    aria-describedby={`name-description${error ? ' name-error' : ''}`}
                    aria-invalid={Boolean(error)}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                      setError('')
                    }}
                  />
                  <FieldDescription id="name-description">可以随时修改。</FieldDescription>
                  <FieldError id="name-error">{error}</FieldError>
                </Field>
              </FieldGroup>
            </DialogBody>
            <DialogFooter>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    )
  }
  const user = userEvent.setup()
  render(<Form />)
  const input = screen.getByRole('textbox', { name: '名称' })
  await user.click(screen.getByText('名称', { exact: true }))
  expect(input).toHaveFocus()
  expect(input).toHaveAccessibleDescription('可以随时修改。')
  await user.keyboard('{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('请输入名称')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription('可以随时修改。 请输入名称')
  expect(saved).not.toHaveBeenCalled()
  await user.type(input, '新的名称{Enter}')
  expect(saved).toHaveBeenCalledExactlyOnceWith('新的名称')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
