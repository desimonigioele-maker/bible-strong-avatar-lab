// Maintenance hook for the A5 acceptance check (scripts-freebuff/verify-dot-surface.mjs).
// No-op in the regular suite; set EXPORT_FIXTURE_DIR to generate the standalone
// "javascript" export (index.html + avatar.js) of a dot-surface avatar whose
// embedded DATA carries explicit softer-softness dot parameters.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAvatar } from '@/features/avatar/avatars'
import {
  createAvatarExportPayload,
  generateJavaScriptAvatarHtml,
  generateJavaScriptAvatarModule,
} from '@/features/export/exporter'
import { initialExpressions } from '@/features/avatar/presets'
import { createInitialSequences } from '@/features/animation/sequences'

const buildDotFixturePayload = () => {
  const strobi = createAvatar('Strobi')
  const dotAvatar = {
    ...strobi,
    name: 'Dot Fixture',
    body: {
      ...strobi.body,
      primary: {
        type: 'dot',
        width: 240,
        height: 240,
        depth: 240,
        roundness: 1,
        dot: {
          color: '#7c5cff',
          wobble: 0.06,
          sssColor: '#b9a4ff',
          sssStrength: 0.7,
          eyeOffsetX: 0,
          eyeOffsetY: 0,
          seed: 3,
          softness: 'softer',
        },
      } as const,
      nodes: [],
    },
  }
  return createAvatarExportPayload(
    dotAvatar,
    initialExpressions,
    createInitialSequences().filter(item => ['idle'].includes(item.id))
  )
}

describe('standalone export fixture (A5 maintenance)', () => {
  it('generates a dot-surface standalone export when EXPORT_FIXTURE_DIR is set', () => {
    const fixtureDir = process.env.EXPORT_FIXTURE_DIR
    if (!fixtureDir) return

    const payload = buildDotFixturePayload()
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(join(fixtureDir, 'avatar.js'), generateJavaScriptAvatarModule(payload))
    writeFileSync(join(fixtureDir, 'index.html'), generateJavaScriptAvatarHtml(payload, 'en'))

    const moduleSource = readFileSync(join(fixtureDir, 'avatar.js'), 'utf8')
    // Every dot surface exports through the SVG blob engine; the Three.js
    // scene (buildDotScene/THREE) is retired from the runtime entirely.
    expect(moduleSource).toContain('AvatarProceduralEngine.buildBlobScene')
    expect(moduleSource).toContain('softDotConfigFromSurface')
    expect(moduleSource).not.toContain('buildDotScene')
    expect(moduleSource).not.toContain('THREE')
    expect(moduleSource).toContain('"softness":"softer"')
    expect(moduleSource).toContain('#7c5cff')
    expect(existsSync(join(fixtureDir, 'index.html'))).toBe(true)
    console.log(`[export-fixture] standalone export written to ${fixtureDir}`)
  })
})
