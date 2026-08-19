import {
  buildAmazonPrimeImportPreview,
  parseAmazonPrimeViewingHistoryCsv
} from '../importers/amazonPrimeViewingHistory.js'
import { createViewingHistoryImportPanel } from './viewingHistoryImportPanel.js'

export function createAmazonPrimeImportPanel(options) {
  return createViewingHistoryImportPanel({
    ...options,
    serviceId: 'amazon-prime-video',
    serviceName: 'Amazon Prime Video',
    fileLabel: 'Amazon Prime Video viewing-history CSV',
    parseCsv: parseAmazonPrimeViewingHistoryCsv,
    buildPreview: buildAmazonPrimeImportPreview
  })
}
