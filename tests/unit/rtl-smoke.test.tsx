// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

describe('RTL smoke test', () => {
  it('renders and queries a simple element', () => {
    render(<div>hello</div>)
    expect(screen.getByText('hello')).toBeDefined()
  })
})
