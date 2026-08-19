import {
  buildNetflixImportPreview,
  parseNetflixViewingHistoryCsv
} from '../importers/netflixViewingHistory.js'
import { createViewingHistoryImportPanel } from './viewingHistoryImportPanel.js'

export function createNetflixImportPanel(options) {
  return createViewingHistoryImportPanel({
    ...options,
    serviceId: 'netflix',
    serviceName: 'Netflix',
    fileLabel: 'Netflix ViewingActivity CSV',
    parseCsv: parseNetflixViewingHistoryCsv,
    buildPreview: buildNetflixImportPreview
  })
}
