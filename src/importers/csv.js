export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function parseCsvRows(text) {
  const rows = []
  let blankRows = 0
  let row = []
  let value = ''
  let quoted = false

  function finishRow() {
    row.push(value)
    if (row.length === 1 && !row[0].trim()) {
      blankRows += 1
    } else {
      rows.push(row)
    }
    row = []
    value = ''
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      finishRow()
    } else {
      value += character
    }
  }

  if (quoted) {
    throw new Error('The CSV contains an unterminated quoted value.')
  }

  if (row.length || value.length) {
    finishRow()
  }

  return { rows, blankRows }
}
