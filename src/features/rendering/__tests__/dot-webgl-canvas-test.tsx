// @vitest-environment jsdom

import { render } from '@testing-library/react'

import { DotWebglCanvas } from '@/features/rendering/components/DotWebglCanvas'
import { createDefaultBlobConfig } from '@/features/rendering/blob/blobTypes'

/**
 * The adapter's interface contract, from the side the studio consumes.
 *
 * jsdom exposes no WebGL2 (getContext is unimplemented), so this environment
 * IS the fallback case: the component must render the SVG engine's markup —
 * the same renderer exports ship — namespaced under the given id prefix, and
 * it must follow config changes without remounting.
 */
describe('DotWebglCanvas adapter', () => {
  it('falls back to the SVG engine when WebGL2 is unavailable', () => {
    const { container } = render(
      <DotWebglCanvas config={createDefaultBlobConfig()} idPrefix="test-dot" />
    )
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('.dot-webgl2-canvas')).toBeNull()
    // Namespaced ids: two dots on one page can never collide.
    expect(container.innerHTML).toContain('test-dot-')
  })

  it('re-renders the fallback when the config changes', () => {
    const first = createDefaultBlobConfig()
    const { container, rerender } = render(<DotWebglCanvas config={first} idPrefix="a" />)
    const second = { ...first, material: { ...first.material, baseColor: '#ff0000' } }
    rerender(<DotWebglCanvas config={second} idPrefix="b" />)
    // Id-scoped: raw markup also contains 'a-' inside aria-* attributes.
    expect(container.querySelector('#b-clip')).not.toBeNull()
    expect(container.querySelector('#a-clip')).toBeNull()
  })
})
