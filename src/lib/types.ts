/**
 * Types for the C2PA Conformance Tool.
 * Report format is crJSON (native) + conformance-tool metadata.
 */

import type { CrJson, CrJsonSignatureInfo, CrJsonValidationResults } from './crjson'

export type {
  CrJson,
  CrJsonManifestEntry,
  CrJsonValidationResults,
  CrJsonAssertionItem,
  CrJsonIngredientItem,
  CrJsonSignatureInfo,
  CrJsonClaimInfo
} from './crjson'

export interface IcaOcspInfo {
  status: 'good' | 'revoked' | 'unknown' | 'inaccessible' | 'no_responder' | 'untrusted_root' | 'root_ca'
  responderUrl?: string
  icaSubjectCn?: string
  icaIssuerCn?: string
  serialNumber?: string
  thisUpdate?: string
  nextUpdate?: string
  revokedAt?: string
  revocationReason?: string
}

/** Report returned by processFile: crJSON (native format) plus conformance-tool metadata */
export interface ConformanceReport extends CrJson {
  usedITL?: boolean
  usedTestCerts?: boolean
  fetchedRemoteManifest?: boolean
  remoteManifestUrl?: string
  _icaOcsp?: Record<string, IcaOcspInfo>
  _conformanceToolVersion?: {
    commit: string
    shortCommit: string
    date: string
    branch: string
    generatedAt: string
  }
}

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
  signer?: string
  mimeType?: string | null
  thumbnailSrc?: string
  date?: string
  ingredientCount: number
  inceptions: string[]
  transformations: string[]
  relationship?: string
  isStub?: boolean
  children: OverviewNode[]
  isRevoked?: boolean
  isOcspGood?: boolean
  isIcaOcspGood?: boolean
  isFullChainOcsp?: boolean
  icaName?: string
  leafOcspStatus?: string
  icaOcspStatus?: string
  validationStatus?: CrJsonValidationResults
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
