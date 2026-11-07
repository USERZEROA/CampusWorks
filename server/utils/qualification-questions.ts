/** Administrative information is collected separately after an offer. */
export function administrativeQuestion(prompt: string): boolean {
  return /\b(?:citizenship|nationality|social security|ssn|passport|visa|immigration|payroll|date of birth|birth date|birthdate|work authori[sz]ation|employment authori[sz]ation|work permit|duke\s+(?:unique\s+)?(?:id|identifier)|institution(?:al)?\s+(?:id|identifier)|student\s+(?:id|identifier)|netid|gender|religion|ethnicity|racial identity|disabilit\w*|medical condition|medical history|health status|health condition|health history|health insurance|mental health|physical health)\b/i.test(prompt)
    || /\b(?:your|applicant(?:'s)?|what|which)\s+race\b|\b(?:select|state|list)\s+(?:your\s+)?race\b|\brace\s*(?:\/|and|or)\s*ethnicity\b|^\s*(?:what is (?:your )?)?race\s*[?:]?\s*$/i.test(prompt)
    || /\b(?:your|personal|good|poor)\s+health\b(?!\s+checks?\b)/i.test(prompt)
}

export function aiQualificationQuestion(question: { purpose?: unknown; prompt?: unknown }): boolean {
  return question.purpose === 'qualification' && typeof question.prompt === 'string' && !administrativeQuestion(question.prompt)
}

export function qualificationQuestionPurpose(prompt: string, purpose?: unknown): 'qualification' {
  const message = purpose !== undefined && purpose !== 'qualification' ? 'Screening questions must concern qualifications' : administrativeQuestion(prompt) ? 'Use qualification questions; administrative information is collected after an offer' : ''
  if (message) throw Object.assign(new Error(message), { statusCode: 400, statusMessage: message })
  return 'qualification'
}

