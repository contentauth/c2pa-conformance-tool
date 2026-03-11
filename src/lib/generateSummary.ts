/**
 * Generates a human-readable summary of a C2PA manifest.
 * e.g. "This photo was taken with a Sony camera and edited in Adobe Photoshop."
 * Reads directly from crJSON manifest entry via getters.
 */

import type { CrJsonManifestEntry, CrJsonIngredientItem } from './types'
import { getAssertionDataByLabel, getClaimInfo, getSignatureInfo, getAssertionsList } from './crjson'

// IPTC digital source types
const SOURCE_TYPE = {
  TRAINED_ALGORITHMIC: 'trainedAlgorithmicMedia',
  COMPOSITE_AI: 'compositeWithTrainedAlgorithmicMedia',
  DIGITAL_CAPTURE: 'digitalCapture',
  DIGITAL_ART: 'digitalArt',
  SCREEN_CAPTURE: 'screenCapture',
  COMPUTATIONAL: 'computationalMedia',
  COMPOSITE: 'compositeSynthetic',
  MINOR_HUMAN_EDITS: 'minorHumanEdits',
  ALGORITHMIC_MEDIA: 'algorithmicMedia',
} as const

// C2PA action types
const ACTION = {
  CONVERTED: 'c2pa.converted',
  EDITED: 'c2pa.edited',
  FILTERED: 'c2pa.filtered',
  COLOR_ADJUSTED: 'c2pa.color_adjustments',
  RESIZED: 'c2pa.resized',
  OPENED: 'c2pa.opened',
  PLACED: 'c2pa.placed',
  CREATED: 'c2pa.created',
  PUBLISHED: 'c2pa.published',
  TRANSCODED: 'c2pa.transcoded',
  AI_GENERATED: 'c2pa.ai.generatedContent',
  DREW: 'c2pa.drew',
  CROPPED: 'c2pa.cropped',
  REPACKAGED: 'c2pa.repackaged',
} as const

function cleanName(name: string): string {
  if (!name) return ''
  // Strip version suffixes like "AppName/1.0" or "AppName 1.0.0"
  return name.split('/')[0].trim()
}

function getSourceType(url: string | undefined): string {
  if (!url) return ''
  const parts = url.split('/')
  return parts[parts.length - 1] || ''
}

function getMediaWord(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio file'
  if (mimeType === 'application/pdf') return 'document'
  return 'file'
}

interface AssertionData {
  actions?: Array<{
    action?: string
    digitalSourceType?: string
    softwareAgent?: string | { name?: string }
    description?: string
  }>
  digitalSourceType?: string
  make?: string
  model?: string
  softwareAgent?: string | { name?: string }
}

function getAssertionData(manifest: CrJsonManifestEntry, label: string): AssertionData | null {
  const data = getAssertionDataByLabel(manifest, label)
  return (data as AssertionData) ?? null
}

function getAllActions(manifest: CrJsonManifestEntry): Array<{ action: string; digitalSourceType?: string; softwareAgent?: string }> {
  const actionsAssertion = getAssertionData(manifest, 'c2pa.actions')
  if (!actionsAssertion?.actions) return []
  return actionsAssertion.actions.map(a => ({
    action: a.action ?? '',
    digitalSourceType: a.digitalSourceType,
    softwareAgent: typeof a.softwareAgent === 'string'
      ? a.softwareAgent
      : a.softwareAgent?.name,
  }))
}

function getPrimaryDigitalSourceType(manifest: CrJsonManifestEntry): string {
  // Check top-level assertion first
  const actionsData = getAssertionData(manifest, 'c2pa.actions')
  if (actionsData?.digitalSourceType) {
    return getSourceType(actionsData.digitalSourceType)
  }

  // Check individual actions
  const actions = getAllActions(manifest)
  for (const action of actions) {
    if (action.digitalSourceType) {
      return getSourceType(action.digitalSourceType)
    }
  }

  // Check creative work assertion
  const creativeWork = getAssertionData(manifest, 'stds.schema.org/CreativeWork')
  if (creativeWork?.digitalSourceType) {
    return getSourceType(creativeWork.digitalSourceType as unknown as string)
  }

  return ''
}

function getSoftwareAgentName(agent: string | { name?: string } | undefined): string {
  if (!agent) return ''
  if (typeof agent === 'string') return cleanName(agent)
  return cleanName(agent.name ?? '')
}

function getEditingSoftware(manifest: CrJsonManifestEntry): string[] {
  const tools = new Set<string>()
  const actions = getAllActions(manifest)
  for (const action of actions) {
    if (action.softwareAgent) {
      const name = getSoftwareAgentName(action.softwareAgent)
      if (name) tools.add(name)
    }
  }
  return [...tools]
}

function getCameraInfo(manifest: CrJsonManifestEntry): string {
  for (const { data } of getAssertionsList(manifest)) {
    const d = data as AssertionData
    if (d?.make || d?.model) {
      const make = d.make ?? ''
      const model = d.model ?? ''
      if (make && model) return `${make} ${model}`
      if (make) return `${make} camera`
      if (model) return model
    }
  }
  return ''
}

function getSignerName(manifest: CrJsonManifestEntry, usedITL: boolean): string {
  const claimInfo = getClaimInfo(manifest)
  const sigInfo = getSignatureInfo(manifest)
  if (usedITL) {
    const generatorName = claimInfo?.claim_generator_info?.[0]?.name
    if (generatorName) return cleanName(generatorName)
  }
  return sigInfo?.common_name ?? ''
}

function getClaimGeneratorName(manifest: CrJsonManifestEntry): string {
  const claimInfo = getClaimInfo(manifest)
  const generatorName = claimInfo?.claim_generator_info?.[0]?.name
  if (generatorName) return cleanName(generatorName)
  return ''
}

function getCommonName(manifest: CrJsonManifestEntry): string {
  return getSignatureInfo(manifest)?.common_name ?? ''
}

function hasAIActions(manifest: CrJsonManifestEntry): boolean {
  const actions = getAllActions(manifest)
  return actions.some(a => a.action === ACTION.AI_GENERATED)
}

function getHumanReadableActions(manifest: CrJsonManifestEntry): string[] {
  const actions = getAllActions(manifest)
  const descriptions: string[] = []

  const editActions = [ACTION.EDITED, ACTION.FILTERED, ACTION.COLOR_ADJUSTED, ACTION.CROPPED, ACTION.RESIZED, ACTION.DREW]
  const hasEdit = actions.some(a => editActions.includes(a.action as typeof editActions[number]))
  if (hasEdit) descriptions.push('edited')

  if (actions.some(a => a.action === ACTION.CONVERTED || a.action === ACTION.TRANSCODED || a.action === ACTION.REPACKAGED)) {
    descriptions.push('converted')
  }

  return descriptions
}

export interface ManifestSummary {
  sentence: string
  details: string[]
}

export function generateManifestSummary(
  manifest: CrJsonManifestEntry | null | undefined,
  ingredients: CrJsonIngredientItem[],
  mimeType: string,
  usedITL: boolean = false,
  isTrusted: boolean = true,
): ManifestSummary {
  if (!manifest) return { sentence: '', details: [] }

  const mediaWord = getMediaWord(mimeType)
  const sourceType = getPrimaryDigitalSourceType(manifest)
  const signerName = getSignerName(manifest, usedITL)
  const cameraInfo = getCameraInfo(manifest)
  const editingSoftware = getEditingSoftware(manifest)
  const aiActions = hasAIActions(manifest)
  const humanActions = getHumanReadableActions(manifest)

  const parts: string[] = []
  const details: string[] = []

  if (!isTrusted) {
    // For untrusted signatures: "This is a [media] from [claim_generator] signed by [common_name]"
    const claimGenerator = getClaimGeneratorName(manifest)
    const commonName = getCommonName(manifest)
    const articleSuffix = mimeType.startsWith('image/') ? 'n' : ''
    let originPhrase = `This is a${articleSuffix} ${mediaWord}`
    if (claimGenerator) originPhrase += ` from ${claimGenerator}`
    if (commonName) originPhrase += ` signed by ${commonName}`
    parts.push(originPhrase)
  } else {
    // --- Determine the origin phrase ---
    const isFullyAIGenerated = sourceType === SOURCE_TYPE.TRAINED_ALGORITHMIC || sourceType === SOURCE_TYPE.ALGORITHMIC_MEDIA
    const hasAIComposite = sourceType === SOURCE_TYPE.COMPOSITE_AI || aiActions
    const isCameraCapture = sourceType === SOURCE_TYPE.DIGITAL_CAPTURE || !!cameraInfo

    if (isFullyAIGenerated) {
      // "This is an AI-generated image"
      const creator = editingSoftware[0] || signerName
      if (creator) {
        parts.push(`This is a${mimeType.startsWith('image/') ? 'n' : ''} ${mediaWord} generated by ${creator}`)
      } else {
        parts.push(`This is an AI-generated ${mediaWord}`)
      }
    } else if (isCameraCapture) {
      // "This is a photo from a Sony camera"
      if (cameraInfo) {
        parts.push(`This is a photo taken with a ${cameraInfo}`)
      } else {
        parts.push(`This is a captured ${mediaWord}`)
      }
    } else if (sourceType === SOURCE_TYPE.DIGITAL_ART) {
      const creator = editingSoftware[0] || signerName
      parts.push(creator ? `This is a digital artwork created with ${creator}` : `This is a digital artwork`)
    } else if (sourceType === SOURCE_TYPE.SCREEN_CAPTURE) {
      parts.push(`This is a screen capture`)
    } else {
      // Generic fallback
      const creator = editingSoftware[0] || signerName
      parts.push(creator ? `This is a${mimeType.startsWith('image/') ? 'n' : ''} ${mediaWord} from ${creator}` : `This is a${mimeType.startsWith('image/') ? 'n' : ''} ${mediaWord}`)
    }

    // --- Determine modifications ---
    const modifications: string[] = []

    if (hasAIComposite) {
      modifications.push('modified using generative AI')
    } else if (humanActions.includes('edited') && editingSoftware.length > 0) {
      const toolList = editingSoftware.slice(0, 2).join(' and ')
      modifications.push(`edited in ${toolList}`)
    } else if (humanActions.includes('edited')) {
      modifications.push('edited')
    }

    if (humanActions.includes('converted')) {
      modifications.push('converted to a different format')
    }

    if (modifications.length > 0) {
      parts.push(modifications.join(' and '))
    }

  }

  // --- Certificate issuer (from crJSON manifest.signature) ---
  const issuer = getSignatureInfo(manifest)?.issuer
  if (issuer) {
    details.push(`Certificate issued by ${issuer}`)
  }

  // --- Ingredient provenance ---
  const ingredientCount = ingredients?.length ?? 0
  if (ingredientCount > 0) {
    details.push(`Based on ${ingredientCount} source asset${ingredientCount > 1 ? 's' : ''}`)
  }

  // Combine parts into a sentence
  let sentence = ''
  if (parts.length === 1) {
    sentence = parts[0] + '.'
  } else if (parts.length === 2) {
    sentence = parts[0] + ', ' + parts[1] + '.'
  } else if (parts.length > 2) {
    sentence = parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1] + '.'
  }

  // Capitalize first letter
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1)

  return { sentence, details }
}
