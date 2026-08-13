import { describe, expect, it } from 'vitest'
import { hrefFor, matchRoute, normalizeHashPath } from './hashRoute'

describe('normalizeHashPath', () => {
  it('treats an empty hash as the root path', () => {
    expect(normalizeHashPath('')).toBe('/')
    expect(normalizeHashPath('#')).toBe('/')
    expect(normalizeHashPath('#/')).toBe('/')
  })

  it('adds a missing leading slash', () => {
    expect(normalizeHashPath('#a')).toBe('/a')
  })

  it('drops trailing slashes and query strings', () => {
    expect(normalizeHashPath('#/admin/')).toBe('/admin')
    expect(normalizeHashPath('#/b?station=B1')).toBe('/b')
  })

  it('is case-insensitive', () => {
    expect(normalizeHashPath('#/Admin')).toBe('/admin')
  })
})

describe('matchRoute', () => {
  it('resolves the three operational surfaces', () => {
    expect(matchRoute('#/a')).toBe('/a')
    expect(matchRoute('#/b')).toBe('/b')
    expect(matchRoute('#/admin')).toBe('/admin')
  })

  it('resolves the development home screen', () => {
    expect(matchRoute('')).toBe('/')
  })

  it('returns null for unknown paths', () => {
    expect(matchRoute('#/c')).toBeNull()
    expect(matchRoute('#/a/registration')).toBeNull()
  })
})

describe('hrefFor', () => {
  it('produces hash links', () => {
    expect(hrefFor('/a')).toBe('#/a')
  })
})
