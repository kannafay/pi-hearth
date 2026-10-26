import { expect, test } from 'vitest'
import { groupModelsByProvider, modelKey } from './models'

test('friendly provider names label groups without merging distinct provider IDs', () => {
  const first = { provider: 'cc-switch-one', providerName: '同名平台', id: 'shared', name: 'Alpha' }
  const second = { ...first, provider: 'cc-switch-two' }
  const groups = groupModelsByProvider([first, second])
  expect(groups.map(({ provider, label }) => ({ provider, label }))).toEqual([
    { provider: 'cc-switch-one', label: '同名平台' },
    { provider: 'cc-switch-two', label: '同名平台' },
  ])
  expect(modelKey(first)).not.toBe(modelKey(second))
})

test('legacy models and empty provider names fall back to the provider ID', () => {
  expect(
    groupModelsByProvider([
      { provider: 'legacy', id: 'one', name: 'One' },
      { provider: 'blank', providerName: '  ', id: 'two', name: 'Two' },
    ]).map((group) => group.label),
  ).toEqual(['legacy', 'blank'])
})
