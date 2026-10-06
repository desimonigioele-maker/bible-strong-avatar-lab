import { ChevronDown, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { InspectorCard, PanelTitle } from '@/app/components/common'
import { AmbientMotionField, ColorField, NumericField } from '@/app/components/controls'
import { getPreviewGeometry, scaleSurface } from '@/app/studio-utils'
import {
  bodyPrimitiveTypes,
  MAX_BODY_NODES,
  primarySurfaceTypes,
  type BodyNode,
} from '@/features/avatar/body'
import { SurfaceThumbnail } from '@/features/avatar/components/ExpressionWorkspace'
import {
  softDotRenderers,
  defaultSoftDotParams,
  defaultDotSoftness,
  defaultDotSurfaceParams,
  dotSoftnessPresets,
  parseSoftDotParams,
  parseDotParams,
  surfaceLabels,
  surfacePresets,
  type SoftDotQuality,
  type SoftDotSurfaceParams,
  type DotSoftness,
  type SurfaceConfig,
} from '@/features/avatar/surfaces'
import { softDotParamsToConfig, configToSoftDotParams } from '@/features/avatar/softDot'
import { blobMaterialPresets } from '@/features/rendering/blob'
import { findBlobMaterialPreset } from '@/features/rendering/blob/blobPresets'
import {
  allLocks,
  randomizeBlobConfig,
  randomizeGroups,
  unlockedGroups,
  type RandomizeGroup,
  type RandomizeLocks,
} from '@/features/rendering/blob/blobRandomize'
import { avatarTextureTypes, textureLabels } from '@/features/avatar/texture'
import type { StudioController } from '@/features/studio/useStudioController'
import type { AvatarTextureConfig } from '@bible-strong/avatar-core'

function BodyStructureThumbnail({
  surface,
  bodyNodes,
  activeNodeId,
  expression,
}: {
  surface: SurfaceConfig
  bodyNodes: BodyNode[]
  activeNodeId: string
  expression: StudioController['expression']
}) {
  const geometry = getPreviewGeometry(expression, surface, bodyNodes)
  const pathClassName = (nodeId: string | null) =>
    activeNodeId === 'primary'
      ? nodeId === null
        ? 'is-active'
        : 'is-context'
      : nodeId === activeNodeId
        ? 'is-active'
        : 'is-context'

  return (
    <span className="body-structure-thumbnail" aria-hidden="true">
      <svg viewBox="-150 -150 300 300">
        {geometry.backPaths.map((pathValue, index) => (
          <path
            className={pathClassName(geometry.backNodeIds[index] ?? null)}
            d={pathValue}
            key={`back-${geometry.backNodeIds[index] ?? index}`}
          />
        ))}
        <path className={pathClassName(null)} d={geometry.headPath} />
        {geometry.frontPaths.map((pathValue, index) => (
          <path
            className={pathClassName(geometry.frontNodeIds[index] ?? null)}
            d={pathValue}
            key={`front-${geometry.frontNodeIds[index] ?? index}`}
          />
        ))}
      </svg>
    </span>
  )
}

const blobQualityLabels: { value: SoftDotQuality; label: string }[] = [
  { value: 'low', label: 'Basse' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'high', label: 'Haute' },
  { value: 'ultra', label: 'Ultra' },
]

/** French source strings for the randomize locks, translated through `t`. */
const randomizeGroupLabels: Record<RandomizeGroup, string> = {
  shape: 'Forme',
  material: 'Matière',
  light: 'Lumière',
  motion: 'Mouvement',
}

const blobRandomSeeds = [918273, 41207, 77341, 20518, 63092, 88104, 35476, 11729]

/**
 * Inspector for the procedural 2.5D blob surface.
 *
 * Presets come first and fine-tuning second: most users should reach a good
 * look without touching every slider (FASI 49).
 */
/**
 * DOT inspector (FASI 38, 39, 40, 43).
 *
 * The panel is grouped by what the author is actually deciding, not by which
 * module owns the field. Someone tuning a dot thinks in terms of "this shape,
 * this light, this surface", and a flat wall of thirty sliders is unreadable
 * at that level of intent.
 *
 * The five sections below are the common path. `Advanced` holds the renderer
 * choice and the debug overlays, which are the two things an author reaches for
 * when something is wrong rather than when something is being designed.
 */
function SoftDotFields({
  params,
  texture,
  t,
  onChange,
  onTextureChange,
}: {
  params: SoftDotSurfaceParams
  texture: AvatarTextureConfig
  t: (value: string) => string
  onChange: (params: SoftDotSurfaceParams) => void
  onTextureChange: (texture: AvatarTextureConfig) => void
}) {
  const update = (patch: Partial<SoftDotSurfaceParams>) =>
    onChange(parseSoftDotParams({ ...params, ...patch }) ?? params)

  const applyPreset = (presetId: string) => {
    const preset = findBlobMaterialPreset(presetId)
    if (!preset) return
    // The preset replaces the material character but keeps the user's own seed
    // and light position, so switching material never re-rolls the shape.
    update({
      presetId,
      color: preset.material.baseColor,
      roughness: preset.material.roughness,
      sheen: preset.material.sheen,
      fiber: preset.material.fiber,
      grain: preset.material.grain,
      macroNoise: preset.material.macroNoise,
      microNoise: preset.material.microNoise,
      specular: preset.material.specular,
      colorVariation: preset.material.colorVariation,
      deformation: preset.material.deformation,
      colorSpots: preset.material.colorSpots,
    })
  }

  const field = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: keyof SoftDotSurfaceParams
  ) => (
    <NumericField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={next => update({ [key]: next })}
    />
  )

  const section = (title: string, subtitle: string, body: ReactNode) => (
    <AccordionItem value={title} className="dot-inspector-section">
      <AccordionTrigger>{t(title)}</AccordionTrigger>
      <AccordionContent>
        <p className="dot-inspector-hint">{t(subtitle)}</p>
        {body}
      </AccordionContent>
    </AccordionItem>
  )

  const randomize = (groups: readonly RandomizeGroup[]) => {
    const result = randomizeBlobConfig(softDotParamsToConfig(params), groups, params.seed)
    // The bridge is the only writer of the document shape, so a randomize goes
    // through it like any other edit.
    onChange(parseSoftDotParams(configToSoftDotParams(result)) ?? params)
  }

  return (
    <Accordion defaultValue={[t('Forme'), t('Matière')]} className="dot-inspector">
      {section(
        'Forme',
        'La silhouette du dot. Le grain la rend organique, pas bruyante.',
        <>
          <NumericField
            label="Seed"
            value={params.seed}
            min={0}
            max={2147483000}
            step={1}
            onChange={seed => update({ seed: Math.round(seed) })}
          />
        </>
      )}

      {section(
        'Lumière',
        'La lumière appartient à la scène : le dot tourne, la lumière reste.',
        <>
          {field('Intensité', params.intensity, 0, 1, 0.01, 'intensity')}
          {field('Élévation', params.lightZ, 0.05, 1, 0.01, 'lightZ')}
          {field('Douceur', params.softness, 0, 1, 0.01, 'softness')}
          {field('Ambiance', params.ambient, 0, 1, 0.01, 'ambient')}
          {field('Remplissage', params.fillIntensity, 0, 1, 0.01, 'fillIntensity')}
          {field('Rim', params.rimStrength, 0, 1, 0.01, 'rimStrength')}
          {field('Cavité', params.cavityStrength, 0, 1, 0.01, 'cavityStrength')}
          {field('Occlusion', params.aoStrength, 0, 1, 0.01, 'aoStrength')}
        </>
      )}

      {section(
        'Matière',
        'Le preset change tout le caractère de la surface, pas seulement la couleur.',
        <>
          <AmbientMotionField
            label="Matière"
            value={params.presetId}
            options={blobMaterialPresets.map(preset => ({
              value: preset.id,
              label: preset.label,
            }))}
            onChange={applyPreset}
          />
          <ColorField
            label={t('Couleur du blob')}
            value={params.color}
            onChange={color => update({ color })}
          />
          {field('Rugosité', params.roughness, 0, 1, 0.01, 'roughness')}
          {field('Spéculaire', params.specular, 0, 1, 0.01, 'specular')}
          {field('Sheen', params.sheen, 0, 1, 0.01, 'sheen')}
          {field('Taches de couleur', params.colorSpots, 1, 5, 1, 'colorSpots')}
          <AmbientMotionField
            label={t('Texture du corps')}
            value={texture.type}
            options={avatarTextureTypes.map(type => ({ value: type, label: textureLabels[type] }))}
            onChange={next =>
              onTextureChange(
                next === 'none'
                  ? { type: 'none' }
                  : { type: next, intensity: texture.intensity ?? 0.55 }
              )
            }
          />
          {texture.type !== 'none' && (
            <NumericField
              label={t('Intensité de la texture')}
              value={texture.intensity ?? 0.55}
              min={0}
              max={1}
              step={0.01}
              onChange={intensity => onTextureChange({ ...texture, intensity })}
            />
          )}
        </>
      )}

      {section(
        'Surface',
        'La texture se voit de près, pas de loin. Au-delà, elle devient du bruit.',
        <>
          {field('Macro bruit', params.macroNoise, 0, 1, 0.01, 'macroNoise')}
          {field('Micro bruit', params.microNoise, 0, 1, 0.01, 'microNoise')}
          {field('Grain', params.grain, 0, 1, 0.01, 'grain')}
          {field('Fibre', params.fiber, 0, 1, 0.01, 'fiber')}
          {field('Variation de couleur', params.colorVariation, 0, 0.05, 0.005, 'colorVariation')}
          {field('Irrégularité normale', params.deformation, 0, 0.3, 0.005, 'deformation')}
        </>
      )}

      {section(
        'Avancé',
        'Choix du moteur de rendu et outils de diagnostic.',
        <>
          <AmbientMotionField
            label="Qualité"
            value={params.quality}
            options={blobQualityLabels}
            onChange={quality => update({ quality })}
          />
          <AmbientMotionField
            label="Moteur de rendu"
            value={params.renderer}
            options={softDotRenderers.map(value => ({
              value,
              label: value === 'field' ? 'Champ échantillonné' : 'Par pixel (filtre SVG)',
            }))}
            onChange={renderer => update({ renderer })}
          />
          <RandomizeControls onRandomize={randomize} t={t} />
        </>
      )}
    </Accordion>
  )
}

/**
 * Randomize with locks (FASI 40).
 *
 * The locks are the point: "randomize" that can silently discard a face or a
 * chosen material is worse than no button, so each group states what it will
 * and will not touch before it is pressed.
 */
function RandomizeControls({
  onRandomize,
  t,
}: {
  onRandomize: (groups: readonly RandomizeGroup[]) => void
  t: (value: string) => string
}) {
  const [locks, setLocks] = useState<RandomizeLocks>(allLocks(false))

  const toggle = (group: RandomizeGroup) =>
    setLocks(current => ({ ...current, [group]: !current[group] }))

  return (
    <div className="dot-randomize">
      <div className="dot-randomize-locks">
        {randomizeGroups.map(group => (
          <label key={group} className="dot-randomize-lock">
            <input type="checkbox" checked={locks[group]} onChange={() => toggle(group)} />
            {t(randomizeGroupLabels[group])}
          </label>
        ))}
      </div>
      <div className="dot-randomize-actions">
        <Button variant="secondary" size="sm" onClick={() => onRandomize(unlockedGroups(locks))}>
          {t('Variante')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onRandomize(['material'])}>
          {t('Matière')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onRandomize(['light'])}>
          {t('Lumière')}
        </Button>
      </div>
      <p className="dot-inspector-hint">
        {t('Les groupes verrouillés ne changent jamais. Le grain avance à chaque variante.')}
      </p>
    </div>
  )
}

export function BodyConstructionAccordion({
  controller,
  reduceMotion,
}: {
  controller: StudioController
  reduceMotion: boolean
}) {
  const [addOpen, setAddOpen] = useState(false)
  const {
    addBodyNode,
    activeAvatar,
    bodyNodes,
    deleteSelectedBodyNode,
    duplicateSelectedBodyNode,
    expression,
    selectBodyNode,
    selectedBodyNode,
    selectedBodyNodeId,
    surface,
    t,
    updateNodeVector,
    updateAvatarTexture,
    updateSelectedBodyNode,
    updateSurface,
  } = controller

  return (
    <InspectorCard className="body-panel">
      <PanelTitle
        level={3}
        title="Construction du corps"
        subtitle="Une forme principale porte les yeux. Les autres primitives se placent autour d’elle."
      />
      <Accordion
        className="body-tree"
        value={[selectedBodyNodeId]}
        onValueChange={value => {
          const nextNodeId = value.at(-1)
          if (nextNodeId) selectBodyNode(nextNodeId)
        }}
      >
        <AccordionItem value="primary" className="body-node-accordion-item">
          <AccordionTrigger className="body-node-trigger">
            <BodyStructureThumbnail
              surface={surface}
              bodyNodes={bodyNodes}
              activeNodeId="primary"
              expression={expression}
            />
            <span className="body-node-summary">
              <span className="body-node-title-line">
                <strong>{t(surfaceLabels[surface.type])}</strong>
                <Badge>{t('Principale')}</Badge>
              </span>
              <small>{t('porte les yeux')}</small>
            </span>
          </AccordionTrigger>
          <AccordionContent className="body-node-accordion-content">
            <div className="surface-grid body-surface-grid">
              {primarySurfaceTypes.map(type => {
                const previewSurface = type === surface.type ? surface : surfacePresets[type]
                return (
                  <Button
                    className="surface-card"
                    variant="outline"
                    type="button"
                    key={type}
                    aria-pressed={surface.type === type}
                    onClick={() => {
                      if (type !== surface.type) updateSurface({ ...surfacePresets[type] })
                    }}
                  >
                    <SurfaceThumbnail surface={previewSurface} />
                    <span>{t(surfaceLabels[type])}</span>
                  </Button>
                )
              })}
            </div>
            <div className="surface-fields">
              <NumericField
                label="Échelle"
                value={Math.max(surface.width, surface.height, surface.depth)}
                min={120}
                max={300}
                unit="u"
                onChange={size =>
                  updateSurface(
                    scaleSurface(surface, size, { width: 120, height: 120, depth: 100 })
                  )
                }
              />
              <NumericField
                label="Largeur"
                value={surface.width}
                min={120}
                max={300}
                unit="u"
                onChange={width => updateSurface({ ...surface, width })}
              />
              <NumericField
                label="Hauteur"
                value={surface.height}
                min={120}
                max={300}
                unit="u"
                onChange={height => updateSurface({ ...surface, height })}
              />
              <NumericField
                label="Profondeur"
                value={surface.depth}
                min={100}
                max={300}
                unit="u"
                onChange={depth => updateSurface({ ...surface, depth })}
              />
              {(surface.type === 'cube' || surface.type === 'diamond') && (
                <NumericField
                  label="Rondeur"
                  value={surface.roundness}
                  min={0}
                  max={2}
                  step={0.01}
                  onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                  onChange={roundness => updateSurface({ ...surface, roundness })}
                />
              )}
              {surface.type === 'cylinder' && (
                <NumericField
                  label="Rondeur des arêtes"
                  value={surface.roundness}
                  min={0}
                  max={2}
                  step={0.01}
                  onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                  onChange={roundness => updateSurface({ ...surface, roundness })}
                />
              )}
              {(surface.type === 'cylinder' || surface.type === 'cone') && (
                <NumericField
                  label="Rondeur globale"
                  value={surface.morphRoundness ?? 0}
                  min={0}
                  max={2}
                  step={0.01}
                  onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                  onChange={morphRoundness => updateSurface({ ...surface, morphRoundness })}
                />
              )}
              {surface.type === 'cone' && (
                <>
                  <NumericField
                    label="Rondeur pointe"
                    value={surface.tipRoundness ?? 0}
                    min={0}
                    max={2}
                    step={0.01}
                    onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                    onChange={tipRoundness => updateSurface({ ...surface, tipRoundness })}
                  />
                  <NumericField
                    label="Rondeur base"
                    value={surface.baseRoundness ?? 0}
                    min={0}
                    max={2}
                    step={0.01}
                    onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                    onChange={baseRoundness => updateSurface({ ...surface, baseRoundness })}
                  />
                </>
              )}
              {(surface.type === 'blob' || surface.type === 'cloud') && (
                <>
                  <NumericField
                    label="Amplitude des bosses"
                    value={surface.wobble ?? 0.14}
                    min={0}
                    max={1}
                    step={0.01}
                    onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                    onChange={wobble => updateSurface({ ...surface, wobble })}
                  />
                  <NumericField
                    label="Graine"
                    value={surface.seed ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                    onChange={seed => updateSurface({ ...surface, seed })}
                  />
                </>
              )}
              {surface.type === 'flower' && (
                <>
                  <NumericField
                    label="Pétales"
                    value={surface.petals ?? 6}
                    min={2}
                    max={16}
                    step={1}
                    onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                    onChange={petals => updateSurface({ ...surface, petals: Math.round(petals) })}
                  />
                  <NumericField
                    label="Profondeur des pétales"
                    value={surface.petalDepth ?? 0.32}
                    min={0}
                    max={1}
                    step={0.01}
                    onActiveChange={active => controller.updateHighlight(active ? 'head' : null)}
                    onChange={petalDepth => updateSurface({ ...surface, petalDepth })}
                  />
                </>
              )}
              {surface.type === 'dot' && (
                <>
                  <AmbientMotionField<DotSoftness>
                    label="Morbidesse"
                    value={(surface.dot ?? defaultDotSurfaceParams).softness ?? defaultDotSoftness}
                    options={[
                      { value: 'plush', label: 'Peluche' },
                      { value: 'softer', label: 'Douce' },
                      { value: 'classic', label: 'Classique' },
                    ]}
                    onChange={softness =>
                      updateSurface({
                        ...surface,
                        dot: {
                          ...(surface.dot ?? defaultDotSurfaceParams),
                          softness,
                          sssStrength: dotSoftnessPresets[softness].uSSSStrength,
                        },
                      })
                    }
                  />
                  <ColorField
                    label={t('Couleur du dot')}
                    value={(surface.dot ?? defaultDotSurfaceParams).color}
                    onChange={color =>
                      updateSurface({
                        ...surface,
                        dot: { ...(surface.dot ?? defaultDotSurfaceParams), color },
                      })
                    }
                  />
                  <ColorField
                    label={t('Subsurface (SSS)')}
                    value={(surface.dot ?? defaultDotSurfaceParams).sssColor}
                    onChange={sssColor =>
                      updateSurface({
                        ...surface,
                        dot: { ...(surface.dot ?? defaultDotSurfaceParams), sssColor },
                      })
                    }
                  />
                  <NumericField
                    label="SSS"
                    value={(surface.dot ?? defaultDotSurfaceParams).sssStrength}
                    min={0}
                    max={2}
                    step={0.01}
                    onChange={sssStrength =>
                      updateSurface({
                        ...surface,
                        dot: { ...(surface.dot ?? defaultDotSurfaceParams), sssStrength },
                      })
                    }
                  />
                  <NumericField
                    label={t('Wobble')}
                    value={(surface.dot ?? defaultDotSurfaceParams).wobble}
                    min={0}
                    max={0.3}
                    step={0.005}
                    onChange={wobble =>
                      updateSurface({
                        ...surface,
                        dot: { ...(surface.dot ?? defaultDotSurfaceParams), wobble },
                      })
                    }
                  />
                  <NumericField
                    label="Seed"
                    value={(surface.dot ?? defaultDotSurfaceParams).seed}
                    min={-1000}
                    max={1000}
                    step={1}
                    onChange={seed =>
                      updateSurface({
                        ...surface,
                        dot: parseDotParams({
                          ...(surface.dot ?? defaultDotSurfaceParams),
                          seed: Math.round(seed),
                        }),
                      })
                    }
                  />
                  <NumericField
                    label={t('Écart des yeux')}
                    value={(surface.dot ?? defaultDotSurfaceParams).eyeOffsetX}
                    min={-0.4}
                    max={0.4}
                    step={0.01}
                    onChange={eyeOffsetX =>
                      updateSurface({
                        ...surface,
                        dot: parseDotParams({
                          ...(surface.dot ?? defaultDotSurfaceParams),
                          eyeOffsetX,
                        }),
                      })
                    }
                  />
                  <NumericField
                    label={t('Hauteur des yeux')}
                    value={(surface.dot ?? defaultDotSurfaceParams).eyeOffsetY}
                    min={-0.4}
                    max={0.4}
                    step={0.01}
                    onChange={eyeOffsetY =>
                      updateSurface({
                        ...surface,
                        dot: parseDotParams({
                          ...(surface.dot ?? defaultDotSurfaceParams),
                          eyeOffsetY,
                        }),
                      })
                    }
                  />
                </>
              )}
              {surface.type === 'softDot' && (
                <SoftDotFields
                  params={surface.softDot ?? defaultSoftDotParams}
                  texture={activeAvatar.texture}
                  t={t}
                  onChange={softDot => updateSurface({ ...surface, softDot })}
                  onTextureChange={updateAvatarTexture}
                />
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {bodyNodes.map(node => (
          <AccordionItem value={node.id} key={node.id} className="body-node-accordion-item">
            <AccordionTrigger className="body-node-trigger">
              <BodyStructureThumbnail
                surface={surface}
                bodyNodes={bodyNodes}
                activeNodeId={node.id}
                expression={expression}
              />
              <span className="body-node-summary">
                <strong>{t(node.name)}</strong>
                <small>{t(surfaceLabels[node.surface.type])}</small>
              </span>
            </AccordionTrigger>
            <AccordionContent className="body-node-accordion-content">
              {selectedBodyNodeId === node.id && selectedBodyNode && (
                <div className="body-node-editor">
                  <div className="body-node-actions">
                    <strong>{t('Réglages de la forme')}</strong>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={bodyNodes.length >= MAX_BODY_NODES}
                        onClick={duplicateSelectedBodyNode}
                      >
                        {t('Dupliquer')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        type="button"
                        onClick={deleteSelectedBodyNode}
                      >
                        {t('Supprimer')}
                      </Button>
                    </div>
                  </div>
                  <p className="body-gizmo-help">
                    <Badge variant="outline">{t('Gizmo local')}</Badge>
                    {t('Glisse un axe pour déplacer la forme, ou un anneau pour la faire tourner.')}
                  </p>
                  <div className="surface-fields">
                    <NumericField
                      label="Échelle"
                      value={Math.max(
                        selectedBodyNode.surface.width,
                        selectedBodyNode.surface.height,
                        selectedBodyNode.surface.depth
                      )}
                      min={10}
                      max={300}
                      unit="u"
                      onChange={size =>
                        updateSelectedBodyNode(currentNode => ({
                          ...currentNode,
                          surface: scaleSurface(currentNode.surface, size, {
                            width: 10,
                            height: 10,
                            depth: 10,
                          }),
                        }))
                      }
                    />
                    {(['width', 'height', 'depth'] as const).map(dimension => (
                      <NumericField
                        key={dimension}
                        label={
                          { width: 'Largeur', height: 'Hauteur', depth: 'Profondeur' }[dimension]
                        }
                        value={selectedBodyNode.surface[dimension]}
                        min={10}
                        max={300}
                        unit="u"
                        onChange={value =>
                          updateSelectedBodyNode(currentNode => ({
                            ...currentNode,
                            surface: { ...currentNode.surface, [dimension]: value },
                          }))
                        }
                      />
                    ))}
                    {(selectedBodyNode.surface.type === 'cube' ||
                      selectedBodyNode.surface.type === 'diamond' ||
                      selectedBodyNode.surface.type === 'cylinder') && (
                      <NumericField
                        label="Rondeur"
                        value={selectedBodyNode.surface.roundness}
                        min={0}
                        max={2}
                        step={0.01}
                        onChange={roundness =>
                          updateSelectedBodyNode(currentNode => ({
                            ...currentNode,
                            surface: { ...currentNode.surface, roundness },
                          }))
                        }
                      />
                    )}
                    {(selectedBodyNode.surface.type === 'cylinder' ||
                      selectedBodyNode.surface.type === 'cone') && (
                      <NumericField
                        label="Rondeur globale"
                        value={selectedBodyNode.surface.morphRoundness ?? 0}
                        min={0}
                        max={2}
                        step={0.01}
                        onChange={morphRoundness =>
                          updateSelectedBodyNode(currentNode => ({
                            ...currentNode,
                            surface: { ...currentNode.surface, morphRoundness },
                          }))
                        }
                      />
                    )}
                    {selectedBodyNode.surface.type === 'cone' && (
                      <>
                        <NumericField
                          label="Rondeur pointe"
                          value={selectedBodyNode.surface.tipRoundness ?? 0}
                          min={0}
                          max={2}
                          step={0.01}
                          onChange={tipRoundness =>
                            updateSelectedBodyNode(currentNode => ({
                              ...currentNode,
                              surface: { ...currentNode.surface, tipRoundness },
                            }))
                          }
                        />
                        <NumericField
                          label="Rondeur base"
                          value={selectedBodyNode.surface.baseRoundness ?? 0}
                          min={0}
                          max={2}
                          step={0.01}
                          onChange={baseRoundness =>
                            updateSelectedBodyNode(currentNode => ({
                              ...currentNode,
                              surface: { ...currentNode.surface, baseRoundness },
                            }))
                          }
                        />
                      </>
                    )}
                  </div>
                  <div className="body-transform-grid">
                    <div>
                      <h3>{t('Position locale')}</h3>
                      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                        <NumericField
                          key={axis}
                          label={axis}
                          value={selectedBodyNode.position[index]}
                          unit="u"
                          onChange={value =>
                            updateNodeVector('position', index as 0 | 1 | 2, value)
                          }
                        />
                      ))}
                    </div>
                    <div>
                      <h3>{t('Rotation locale')}</h3>
                      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                        <NumericField
                          key={axis}
                          label={axis}
                          value={selectedBodyNode.rotation[index]}
                          unit="°"
                          onChange={value =>
                            updateNodeVector('rotation', index as 0 | 1 | 2, value)
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="body-add">
        <Button
          className="body-add-trigger"
          variant="outline"
          type="button"
          aria-expanded={addOpen}
          disabled={bodyNodes.length >= MAX_BODY_NODES}
          onClick={() => setAddOpen(open => !open)}
        >
          <Plus />
          <span>{t('Ajouter une forme')}</span>
          <small>
            {bodyNodes.length}/{MAX_BODY_NODES}
          </small>
          <ChevronDown />
        </Button>
        <AnimatePresence initial={false}>
          {addOpen && (
            <motion.div
              className="body-add-options"
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            >
              {bodyPrimitiveTypes.map(type => (
                <Button
                  className="surface-card body-add-card"
                  variant="outline"
                  type="button"
                  key={type}
                  onClick={() => {
                    addBodyNode(type)
                    setAddOpen(false)
                  }}
                >
                  <SurfaceThumbnail surface={surfacePresets[type]} />
                  <span>{t(surfaceLabels[type])}</span>
                </Button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </InspectorCard>
  )
}
