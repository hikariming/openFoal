import { describe, expect, it } from 'vitest'
import { routePaths } from '@/app/router/route-paths'

describe('routePaths', () => {
  it('contains sandbox route', () => {
    expect(routePaths.sandbox).toBe('/sandbox')
  })

  it('contains unique route values', () => {
    const values = Object.values(routePaths)
    expect(new Set(values).size).toBe(values.length)
  })
})
