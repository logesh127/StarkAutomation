import { api } from './api'

// sections: [{ name, duration }]
// questionsBySection: { [sectionName]: [q_id, ...] }
// Pass existingTestId to update an already-created test instead of creating a new one.
export async function saveTest({ token, existingTestId, testName, testType, visibility, bdId, createdBy, sections, questionsBySection }) {
  const groupPayload = sections.map(sec => ({ sectionName: sec.name, groupList: [] }))
  const sectionsPayload = sections.map(sec => ({ name: sec.name, duration: sec.duration, additionalinfo: null }))
  const questionsPayload = sections.map(sec => ({ sectionName: sec.name, questionList: questionsBySection[sec.name] || [] }))

  let testId = existingTestId

  if (!testId) {
    const createRes = await api.createTest(token, {
      testName, testType, visibility, b_d_id: bdId, createdBy,
      import: 'original_test', mainDepartmentUser: true, publishStatus: 'draft'
    })
    testId = createRes.data
    if (!testId) throw new Error('No test ID returned from create step.')

    await api.updateTest(token, testId, {
      testName, testType, visibility, b_d_id: bdId, createdBy,
      import: 'original_test', mainDepartmentUser: true, publishStatus: 'draft',
      group: groupPayload, sections: sectionsPayload
    })
  }

  await api.updateTest(token, testId, {
    testName, testType, visibility, createdBy,
    import: 'has_imported_questions', mainDepartmentUser: true, publishStatus: 'draft',
    group: groupPayload, sections: sectionsPayload, questions: questionsPayload
  })

  await api.updateTest(token, testId, {
    testName, testType, visibility, createdBy,
    import: 'has_imported_questions', mainDepartmentUser: true, publishStatus: 'published',
    group: groupPayload, sections: sectionsPayload, questions: questionsPayload
  })

  return testId
}
