/**
 * Types for the C2PA Conformance Tool.
 * Report format is crJSON (native) + conformance-tool metadata.
 */

import type { CrJson, CrJsonSignatureInfo } from './crjson'

export type {
  CrJson,
  CrJsonManifestEntry,
  CrJsonValidationResults,
  CrJsonAssertionItem,
  CrJsonIngredientItem,
  CrJsonSignatureInfo,
  CrJsonClaimInfo
} from './crjson'

/** Report returned by processFile: crJSON (native format) plus conformance-tool metadata */
export interface ConformanceReport extends CrJson {
  usedITL?: boolean
  usedTestCerts?: boolean
  _conformanceToolVersion?: {
    commit: string
    shortCommit: string
    date: string
    branch: string
    generatedAt: string
  }
}

/** Re-export for components that still reference ValidationStatus from SDK */
export type { ValidationStatus } from '@contentauth/c2pa-web'

/** One validation status row in the report UI */
export interface ValidationStatusItem {
  code: string
  success: boolean
  isInterim?: boolean
  isInformational?: boolean
  explanation?: string
}

/** Node in the overview provenance tree */
export interface OverviewNode {
  manifestIdx: number
  claimGenerator?: string
  mimeType?: string | null
  thumbnailSrc?: string
  date?: string
  ingredientCount: number
  inceptions: string[]
  transformations: string[]
  relationship?: string
  isStub?: boolean
  children: OverviewNode[]
}

/** Node in the ingredient provenance tree */
export interface IngredientTreeNode {
  title: string
  format?: string
  relationship?: string
  thumbnailSrc?: string
  claimGenerator?: string
  isRoot: boolean
  children: IngredientTreeNode[]
}

/** Grouped validation status by manifest */
export interface ManifestValidationGroup {
  label: string
  isActive: boolean
  index: number
  sigInfo?: CrJsonSignatureInfo
  success: ValidationStatusItem[]
  failure: ValidationStatusItem[]
  informational: ValidationStatusItem[]
}

/** Assertion summary row for display */
export interface AssertionSummaryItem {
  key: string
  value: unknown
  digitalSourceType?: string
  isAction?: boolean
  actionName?: string
  description?: string
}
