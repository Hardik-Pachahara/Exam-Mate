// Tool schema Claude must fill in: the passages worth highlighting on one page.
export const CATEGORIES = {
  definition: { label: 'Definition', color: '#5aa9ff' },
  key_point:  { label: 'Key point',  color: '#ffd23f' },
  formula:    { label: 'Formula / rule', color: '#ff6b7a' },
  example:    { label: 'Example',    color: '#4fd6a0' },
  fact:       { label: 'Date / name / fact', color: '#c58bff' }
};

export const highlightTool = {
  name: 'highlight_passages',
  description: 'Return the passages of this page a student should highlight for exam revision.',
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Short title of what this page covers' },
      passages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Exact text copied from the page, 3 to 40 consecutive words' },
            category: { type: 'string', enum: Object.keys(CATEGORIES) },
            reason: { type: 'string', description: 'Why this matters for exams, under 12 words' }
          },
          required: ['text', 'category']
        }
      }
    },
    required: ['topic', 'passages']
  }
};
