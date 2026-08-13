import { describe, expect, it } from 'vitest'
import {
  MAX_NAME_LENGTH,
  phoneDigits,
  validateEmail,
  validateName,
  validatePhone,
  validateRegistrationForm,
} from './validation'

describe('validateName', () => {
  it('requires a value', () => {
    expect(validateName('')).not.toBeNull()
    expect(validateName('   ')).not.toBeNull()
  })

  it('accepts ordinary names', () => {
    for (const name of [
      'Ada Lovelace',
      'Grace',
      "Fiadh O'Brien",
      'Jean-Luc Picard',
      'Aisha Bint Muhammad',
      '李雷',
    ]) {
      expect(validateName(name)).toBeNull()
    }
  })

  it('rejects a name beyond the maximum length', () => {
    expect(validateName('a'.repeat(MAX_NAME_LENGTH))).toBeNull()
    expect(validateName('a'.repeat(MAX_NAME_LENGTH + 1))).not.toBeNull()
  })
})

describe('phoneDigits', () => {
  it('strips the formatting people actually type', () => {
    expect(phoneDigits('+44 (0)20 7946-0958')).toBe('4402079460958')
    expect(phoneDigits('020 7946 0958')).toBe('02079460958')
    expect(phoneDigits('+1.555.010.1234')).toBe('15550101234')
  })
})

describe('validatePhone', () => {
  it('requires a value', () => {
    expect(validatePhone('')).not.toBeNull()
    expect(validatePhone('   ')).not.toBeNull()
  })

  it('accepts normal human formatting', () => {
    for (const phone of [
      '+44 20 7946 0958',
      '(020) 7946-0958',
      '020 7946 0958',
      '+1 555 010 1234',
      '9876543210',
      '+91-98765-43210',
    ]) {
      expect(validatePhone(phone)).toBeNull()
    }
  })

  it('rejects too few digits', () => {
    expect(validatePhone('12345')).not.toBeNull()
    expect(validatePhone('123456')).not.toBeNull()
    expect(validatePhone('1234567')).toBeNull()
  })

  it('rejects too many digits', () => {
    expect(validatePhone('1'.repeat(15))).toBeNull()
    expect(validatePhone('1'.repeat(16))).not.toBeNull()
  })

  it('rejects letters and stray symbols', () => {
    expect(validatePhone('020 CALL ME')).not.toBeNull()
    expect(validatePhone('555#0101234')).not.toBeNull()
  })

  it('does not demand a country code or any specific national format', () => {
    // Deliberate: guessing a participant's country from their digits is a good
    // way to reject real people at a busy desk.
    expect(validatePhone('7946095')).toBeNull()
    expect(validatePhone('+447946095812')).toBeNull()
  })
})

describe('validateEmail', () => {
  it('requires a value', () => {
    expect(validateEmail('')).not.toBeNull()
    expect(validateEmail('  ')).not.toBeNull()
  })

  it('accepts ordinary addresses', () => {
    for (const email of [
      'ada@example.com',
      'ada.lovelace+event@example.co.uk',
      'a@b.io',
      'first_last@sub.domain.org',
    ]) {
      expect(validateEmail(email)).toBeNull()
    }
  })

  it('rejects obviously broken addresses', () => {
    for (const email of [
      'ada',
      'ada@',
      '@example.com',
      'ada@example',
      'ada example@test.com',
      'ada@@example.com',
      'ada@.com',
    ]) {
      expect(validateEmail(email)).not.toBeNull()
    }
  })
})

describe('validateRegistrationForm', () => {
  const VALID = {
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
  }

  it('returns trimmed values on success', () => {
    const result = validateRegistrationForm({
      name: '  Ada Lovelace  ',
      phone: '  +44 20 7946 0958 ',
      email: '  ADA@example.com  ',
    })

    expect(result).toEqual({
      ok: true,
      values: {
        name: 'Ada Lovelace',
        phone: '+44 20 7946 0958',
        email: 'ADA@example.com',
      },
    })
  })

  it('reports every invalid field at once', () => {
    const result = validateRegistrationForm({
      name: '',
      phone: '12',
      email: 'nope',
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual([
      'email',
      'name',
      'phone',
    ])
  })

  it('reports only the field that is wrong', () => {
    const result = validateRegistrationForm({ ...VALID, email: 'nope' })

    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.errors)).toEqual(['email'])
  })
})
