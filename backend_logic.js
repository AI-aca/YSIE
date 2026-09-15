// Supabase 클라이언트 초기화
const SUPABASE_URL = 'https://seuovjrvfcwvzphvvfga.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNldW92anJ2ZmN3dnpwaHZ2ZmdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTA5NDMsImV4cCI6MjEwNDQyNjk0M30.a4HIZIRfL2ktUFjYmmaAeai7YblEg8U0ZDztsQmx3wA';

if (typeof window !== 'undefined' && window.supabase && !window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
/**
 * 공통 Gemini API 호출 모듈 (3단계 폴백 적용)
 */
async function callGeminiAPI(apiKey, systemPrompt, userPrompt, forceModels = null) {
  let key = apiKey;
  if (!key) {
    const { data: settings } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'GeminiKey').single();
    key = settings ? settings.setting_value : '';
  }
  if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다.');
  
  const models = forceModels ? forceModels : ['gemini-3.1-pro-preview', 'gemini-3.7-flash'];
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${key}`;
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 요청 데이터]\n${userPrompt}` }] }
          ],
          generationConfig: { temperature: 0.2 },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
          return data.candidates[0].content.parts[0].text;
        }
      } else {
        lastError = new Error(`Gemini API 오류 (${currentModel}): ` + await response.text());
      }
    } catch (e) {
      lastError = new Error(`Gemini API 통신 실패 (${currentModel}): ` + e.message);
    }
  }
  throw lastError || new Error('모든 Gemini 모델 호출에 실패했습니다.');
}

async function callGeminiWithFallback(systemPrompt, userPrompt, forceModels = null) {
  return await callGeminiAPI('', systemPrompt, userPrompt, forceModels);
}

async function saveStudentMemo(studentLink, memo) {
  try {
    const { error } = await window.supabaseClient.from('students').update({ student_memo: memo }).eq('student_link', studentLink);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getAIChecklist(studentLink, qNum) {
  try {
    const typeKey = '문항' + qNum + '_체크리스트';
    const { data } = await window.supabaseClient.from('ai_feedback_history')
      .select('feedback')
      .eq('student_link', studentLink)
      .eq('type', typeKey)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      return { success: true, checklist: data[0].feedback };
    }
    return { success: true, checklist: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function generateAIChecklist(studentLink, qNum, statementText) {
  try {
    // 1. 해당 학생의 지원 학교 및 문항 내용 조회
    let qContent = '';
    let adminReqText = '';
    const parsedQNum = qNum.includes('|') ? qNum.split('|')[1] : qNum;
    const targetSchoolName = qNum.includes('|') ? qNum.split('|')[0] : '';
    const { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentLink).single();
    if (student) {
      const tSchool = targetSchoolName || student.targetSchool || student.target_school;
      const { data: settingsRow } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'schools').single();
      if (settingsRow && settingsRow.setting_value) {
        try {
          const schoolsData = JSON.parse(settingsRow.setting_value);
          const matchedSchool = schoolsData.find(s => s.name === tSchool);
          if (matchedSchool && matchedSchool.questions) {
            let qRow = matchedSchool.questions.find(q => String(q.label) === String(parsedQNum));
            if (qRow) {
              qContent = qRow.content || '';
              if (qRow.details && qRow.details.length > 0) {
                const titles = qRow.details.map((d, idx) => `${idx + 1}. ${d.title}`).join(', ');
                adminReqText = `학생은 다음의 세부 주제들에 대해 작성해야 한다: ${titles}`;
              }
            }
          }
        } catch (e) {
          console.error('설정 데이터 파싱 에러:', e);
        }
      }
    }

    const { data: fbPromptData, error: promptErr } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_checklist').single();
    if (promptErr || !fbPromptData || !fbPromptData.setting_value) {
      throw new Error('수파베이스에서 체크리스트 프롬프트를 불러오지 못했습니다.');
    }
    let systemPrompt = fbPromptData.setting_value;
    
    let userPrompt = `[문항 ${parsedQNum}번 정보]\n`;
    if (qContent) userPrompt += `질문: ${qContent}\n\n`;
    if (adminReqText) {
      userPrompt += `[관리자 요구조건]:\n${adminReqText}\n\n`;
    }
    userPrompt += `[학생의 실제 작성 내용]:\n${statementText}\n\n`;
    if (adminReqText) {
      userPrompt += `[지시사항]:\n관리자의 요구조건 텍스트 자체를 학생이 쓴 글로 오해하지 말고, 학생의 실제 작성 내용만을 대상으로 요구조건이 잘 충족되었는지 평가하라.\n`;
    }
    
    const feedbackText = await callGeminiWithFallback(systemPrompt, userPrompt, ['gemini-3.7-flash', 'gemini-3.6-flash']);
    
    const targetType = '문항[' + qNum + ']_체크리스트';
    const fbPayload = {
      student_link: studentLink,
      type: targetType,
      feedback: feedbackText,
      created_at: new Date().toISOString()
    };
    await window.supabaseClient.from('ai_feedback_history').delete().eq('student_link', studentLink).eq('type', targetType);
    const { error: fbErr } = await window.supabaseClient.from('ai_feedback_history').insert(fbPayload);
    if (fbErr) throw new Error('체크리스트 저장 실패: ' + fbErr.message);
    
    return { success: true, checklist: feedbackText };
  } catch (err) {
    throw err;
  }
}

async function generateAIFeedback(studentId, qNum, statementText) {
  try {
    const parsedQNum = qNum.includes('|') ? qNum.split('|')[1] : qNum;
    const targetSchoolName = qNum.includes('|') ? qNum.split('|')[0] : '';
    
    const { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentId).single();
    if (!student) return { success: false, error: '학생을 찾을 수 없습니다.' };
    
    const { data: settingsData } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'schools').single();
    const schools = settingsData ? JSON.parse(settingsData.setting_value) : [];
    
    const tSchool = targetSchoolName || student.targetSchool || student.target_school;
    const targetSchoolData = schools.find(s => s.name === tSchool);
    
    let qContent = '';
    if (targetSchoolData && targetSchoolData.questions) {
      const qRow = targetSchoolData.questions.find(q => String(q.label) === String(parsedQNum));
      if (qRow) qContent = qRow.content || '';
    }

    // 수파베이스 DB에서 기밀 프롬프트 로드 (절대 덮어쓰지 않음, 뒤에 제약사항만 덧붙임)
    const { data: fbPromptData } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_feedback').single();
    let baseSystemPrompt = fbPromptData ? fbPromptData.setting_value : "당신은 최고 수준의 입시 컨설턴트입니다.";
    
    const cleanQNum = String(parsedQNum).replace(/^문항\s*/, '');
    const formatConstraint = `\n\n🚨[출력 서식 및 어투 강제 규칙 - 반드시 지킬 것]
이 출력은 학생의 자기소개서 [문항 ${cleanQNum}]에 대한 피드백입니다.
당신에게 부여된 기존의 프롬프트 지시사항(평가 기준 등)을 모두 따르되, **최종 출력물의 형태는 반드시 아래의 4가지 항목으로만 구성된 마크다운(Markdown) 형식**이어야 합니다. (기존의 '종합 총평' 등 다른 임의의 항목은 절대 생성하지 마세요)

### [문항 ${cleanQNum}]
#### 💡 돋보이는 강점
- (핵심 강점을 글머리 기호로 간결하게 요약)

#### ⚠️ 치명적 단점
- (단점이 있을 경우 글머리 기호로 요약. 단점이 없을 경우 불릿(-) 없이 '치명적인 단점은 없습니다.' 한 줄만 출력)

#### 🔧 구체적 수정제안
- (학생이 실천 가능한 구체적 가이드라인을 글머리 기호로 요약)

#### 📝 문항 총평
(위의 3가지 항목과 달리 불릿 기호(-) 없이, 1개의 문단으로 서술하되, 절대 200자를 초과하지 않도록 엄격히 제한합니다.)

🚨[제약 사항]
1. 불릿 포인트(-)를 사용하는 항목(강점, 단점, 수정제안)은 **반드시 항목당 1~2개의 문장(불릿)만** 출력하세요. 절대 3개 이상 출력하지 마세요.
2. 경어체(~습니다)를 절대 사용하지 마세요. 문장을 짧고 간결하게 끊고, 반드시 **명사형 종결(~음, ~함, ~필요, ~누락 등) 어투(음슴체)**를 모든 문장에 엄격하게 적용하세요.
3. '치명적 단점' 항목에는 칭찬이나 장점을 절대 섞어 쓰지 마세요. 만약 학생의 글에 치명적인 단점이 없다면 억지로 만들지 말고 반드시 '치명적인 단점은 없습니다.'라는 단 한 문장만 출력하세요.
`;
    const systemPrompt = baseSystemPrompt + formatConstraint;
    
    // 내용 구조화 (상세분할 태그 → 줄바꿈 변환, 라벨 주입은 프론트엔드에서 완료됨)
    let formattedStatement = statementText.replace(/\[상세분할\]/g, '\n\n');
    
    let userPrompt = `[학생명]: ${student.name}\n[지원 학교]: ${student.targetSchool}\n`;
    userPrompt += `[문항 ${parsedQNum}번 정보]\n`;
    if (qContent) userPrompt += `질문: ${qContent}\n\n`;
    userPrompt += `[학생 작성 내용]:\n${formattedStatement}`;
    
    const feedbackText = await callGeminiWithFallback(systemPrompt, userPrompt, ['gemini-3.7-flash', 'gemini-3.6-flash']);
    
    let safeFeedback = feedbackText;
    if (/^[=+\-@]/.test(safeFeedback) || safeFeedback.startsWith('===')) {
      safeFeedback = "'" + safeFeedback;
    }
    
    const targetType = '문항[' + qNum + ']_도움받기';
    await window.supabaseClient.from('ai_feedback_history').delete().eq('student_link', studentId).eq('type', targetType);
    const fbPayload = {
      student_link: studentId,
      type: targetType,
      feedback: safeFeedback,
      created_at: new Date().toISOString()
    };
    const { error: fbErr } = await window.supabaseClient.from('ai_feedback_history').insert(fbPayload);
    if (fbErr) throw new Error('ai_feedback_history DB 저장 실패: ' + fbErr.message);
    
    const timeStr = new Date().toISOString(); 
    await window.supabaseClient.from('students').update({ cover_letter_feedback_ai: timeStr }).eq('student_link', studentId);
    
    return { success: true, feedback: feedbackText };
  } catch (err) {
    throw err;
  }
}

async function resetAIFeedback(studentId, typeStr) {
  try {
    const res = await window.supabaseClient.from('ai_feedback_history').delete().eq('student_link', studentId).eq('type', typeStr);
    if (res.error) throw new Error(res.error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * 8. AI 면접 예상 질문 생성 (generateAIQuestions)
 */
async function generateAIQuestions(studentId, type) {
  try {
    const { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentId).single();
    if (!student) return { success: false, error: '학생을 찾을 수 없습니다.' };
    
    let systemPrompt = '';
    let studentInputText = '';
    
    const levelConstraint = "\n\n🚨[중요 제약사항]\n질문의 대상은 '중학교 3학년' 학생입니다. 생성된 질문의 단어 사용이나 개념 내용을 '중학교 심화' 수준 이상으로 절대 끌어올리지 마십시오. 대학 전공 수준의 과도하게 전문적이거나 현학적인 어휘의 사용을 엄격히 금지합니다. 중학생 수준에서 이해하고 충분히 답변할 수 있는 현실적인 난이도와 일상적인 어휘를 사용하여 질문을 구성하십시오. 질문 내용이 원본(자소서/생기부)의 수준을 비약적으로 뛰어넘거나 없는 개념을 지레짐작하여 덧붙이지 마십시오.";
    const formatConstraint = `\n\n🚨🚨[출력 서식 강제 규칙 - 위반 시 치명적 오류 발생]🚨🚨
모든 예상 질문 세트는 반드시 아래의 JSON 배열(Array of Objects) 서식을 100% 동일하게 준수하여 출력하십시오. 마크다운 기호(\`\`\`json 등)나 덧붙이는 말 없이 오직 순수한 JSON 텍스트만 출력해야 합니다.
질문 어투는 실제 면접관이 질문하듯 '~해 주세요.', '~하세요.' 형식의 정중하고 명확한 구어체/경어체를 사용하십시오.

[
  {
    "qNum": 1,
    "mainCategory": "대분류명",
    "subCategory": "중분류명",
    "subTitle": "질문의 핵심 요약 키워드",
    "mainQuestion": "실제 면접관이 질문하듯 학생에게 던지는 메인 면접 질문 내용",
    "intention": "이 질문을 통해 확인하고자 하는 학생의 역량 및 평가 요소",
    "tailQuestions": [
      "메인 질문에 이어질 수 있는 추가 압박 질문 1"
    ]
  }
]`;
    
    if (type === '자소서') {
      const { data: settingsData } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'schools').single();
      const schools = settingsData ? JSON.parse(settingsData.setting_value) : [];
      const targetSchoolData = schools.find(s => s.name === student.targetSchool);
      
      const { data: statements } = await window.supabaseClient.from('personal_statements').select('*').eq('student_link', studentId).order('updated_at', { ascending: false });
      let statementText = '';
      const processedQNums = new Set();
      const targetSchoolName = (student.targetSchool || student.target_school || '').trim();
      
      (statements || []).forEach(row => {
        const rowSchool = (row.version_label || '').trim();
        if (rowSchool && rowSchool !== targetSchoolName) return;
        
        if (row.content && row.content.trim() !== '' && !processedQNums.has(row.question_no)) {
          processedQNums.add(row.question_no);
          
          let formattedContent = row.content;
          if (row.content.includes('[상세분할]') && targetSchoolData && targetSchoolData.questions) {
            const qData = targetSchoolData.questions.find(q => String(q.label) === String(row.question_no));
            if (qData && qData.details && qData.details.length > 0) {
              const parts = row.content.split('[상세분할]');
              formattedContent = parts.map((part, idx) => {
                const title = qData.details[idx] ? qData.details[idx].title : `세부항목 ${idx + 1}`;
                return `[${title}]:\n${part.trim()}`;
              }).join('\n\n');
            } else {
              formattedContent = row.content.replace(/\[상세분할\]/g, '\n\n');
            }
          } else {
            formattedContent = row.content.replace(/\[상세분할\]/g, '\n\n');
          }
          
          statementText += '=== 문항 ' + row.question_no + ' ===\n' + formattedContent + '\n\n';
        }
      });
      studentInputText = statementText;
      if (!studentInputText || studentInputText.trim() === '') return { success: false, error: '분석할 자소서 내용이 존재하지 않습니다.' };
      
      // 이미 위에서 targetSchoolData를 구했으므로 그대로 사용 가능
      let schoolQuestionsPrompt = '';
      if (targetSchoolData && targetSchoolData.questions) {
        schoolQuestionsPrompt = "\n[지원 학교 자소서 문항 정보]\n";
        targetSchoolData.questions.forEach((q, idx) => {
          schoolQuestionsPrompt += `${idx + 1}. ${q.label}: ${q.content} (제한: ${q.limit}자)\n`;
        });
      }
      const { data: jasosoPromptData } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_q_jasoso').single();
      const baseJasosoPrompt = jasosoPromptData && jasosoPromptData.setting_value ? jasosoPromptData.setting_value : "프롬프트 로드 실패";
      systemPrompt = baseJasosoPrompt + levelConstraint + formatConstraint + schoolQuestionsPrompt;
    } else if (type === '생기부') {
      const { data: record } = await window.supabaseClient.from('parsed_records').select('parsed_content').eq('student_link', studentId).single();
      studentInputText = record ? record.parsed_content : '';
      if (!studentInputText || studentInputText.trim() === '') return { success: false, error: '분석할 생기부 텍스트 데이터가 존재하지 않습니다.' };
      
      const { data: senggibuPromptData } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_q_senggibu').single();
      const baseSenggibuPrompt = senggibuPromptData && senggibuPromptData.setting_value ? senggibuPromptData.setting_value : "프롬프트 로드 실패";
      systemPrompt = baseSenggibuPrompt + levelConstraint + formatConstraint;
    }
    
    const userPrompt = "[학생명]: " + student.name + "\n[데이터]:\n" + studentInputText;
    const questionText = await callGeminiWithFallback(systemPrompt, userPrompt);
    
    const { data: existingPract } = await window.supabaseClient.from('interview_practice').select('*').eq('student_link', studentId).maybeSingle();
    let updateObj = { 
      student_link: studentId, 
      created_at: new Date().toISOString()
    };
    
    if (type === '자소서') {
      updateObj.statement_questions_json = questionText;
      updateObj.base_version_ps = '자소서 최신버전';
    } else {
      updateObj.record_questions_json = questionText;
      updateObj.base_version_record = '생기부 분석 기준';
    }
    
    let questErr;
    if (existingPract && existingPract.id) {
      const res = await window.supabaseClient.from('interview_practice').update(updateObj).eq('id', existingPract.id);
      questErr = res.error;
    } else {
      const res = await window.supabaseClient.from('interview_practice').insert(updateObj);
      questErr = res.error;
    }
    if (questErr) throw new Error('interview_practice DB 저장 실패: ' + questErr.message);
    
    const timeStr = new Date().toISOString(); 
    const studentUpdateObj = type === '자소서' 
      ? { expected_questions_ai_ps: '자소서' + timeStr } 
      : { expected_questions_ai_record: '생기부' + timeStr };
    await window.supabaseClient.from('students').update(studentUpdateObj).eq('student_link', studentId);
    
    return { success: true, questions: questionText };
  } catch (err) {
    throw err;
  }
}

/**
 * 9. 생기부 점수 정량/정성 평가 (evaluateStudentRecord)
 */
async function evaluateStudentRecord(studentId, recordText) {
  try {
    let { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentId).maybeSingle();
    if (!student) {
      const { data: studentById } = await window.supabaseClient.from('students').select('*').eq('id', studentId).maybeSingle();
      student = studentById;
    }
    if (!student) throw new Error('학생 정보를 수파베이스에서 찾을 수 없습니다.');
    
    const effectiveLink = student.student_link || student.id;
    let textToAnalyze = recordText;
    
    if (!textToAnalyze || textToAnalyze.trim() === "") {
      // 1차: parsed_records 캐시 테이블에서 텍스트 조회
      const { data: cached } = await window.supabaseClient.from('parsed_records').select('parsed_content').eq('student_link', effectiveLink).maybeSingle();
      if (cached && cached.parsed_content && cached.parsed_content.length >= 100) {
        textToAnalyze = cached.parsed_content;
      } else {
        return { success: false, error: 'NOT_PARSED' };
      }
    }
    
    if (!textToAnalyze || textToAnalyze.length < 100) {
      throw new Error('분석할 생기부 PDF 문서 또는 파싱 텍스트가 없습니다. 먼저 생기부 PDF를 업로드해 주십시오.');
    }

    const { data: settings } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'GeminiKey').single();
    const apiKey = settings ? settings.setting_value : '';
    if (!apiKey) throw new Error('Gemini API 키가 수파베이스 settings 테이블에 설정되지 않았습니다.');
    
    // 수파베이스에서 영역별 프롬프트 로드
    const [{ data: dCommon }, { data: dArea1 }, { data: dArea2 }, { data: dArea3 }] = await Promise.all([
      window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_evaluate_common').single(),
      window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_evaluate_area1').single(),
      window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_evaluate_area2').single(),
      window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_evaluate_area3').single()
    ]);
    const commonSystemInstruction = dCommon ? dCommon.setting_value : '';
    const hallucinationLockRule = `
[🚨 파싱 절대 규칙: 성적 위조 및 환각 생성 엄격 금지]
1. mathGrades, sciGrades 등 교과 성적(등급) 데이터를 추출할 때, 반드시 생기부 본문의 <6. 교과학습발달상황> 표(Table) 또는 하단 <성적 통지표> 영역에 "A, B, C, D, E, P" 등 등급 문자가 명시적으로 기재된 팩트 데이터만 추출할 것.
2. <세부능력 및 특기사항>에 적힌 "(1학기) 과학:", "(2학기) 수학:" 등의 텍스트를 근거로 성적표가 존재한다고 멋대로 유추하거나, A등급일 것이라고 지어내는(환각) 행위를 전면 금지함. 표에 없으면 없는 것임.
`;
    const PROMPT_AREA_1 = commonSystemInstruction + "\n" + hallucinationLockRule + (dArea1 ? dArea1.setting_value : '');
    const PROMPT_AREA_2 = commonSystemInstruction + "\n" + hallucinationLockRule + (dArea2 ? dArea2.setting_value : '');
    const PROMPT_AREA_3 = commonSystemInstruction + "\n" + hallucinationLockRule + (dArea3 ? dArea3.setting_value : '');
    
    const PROMPT_OVERALL_REPORT = commonSystemInstruction + `
[최종 단계: 사정관 종합 총평 작성 가이드라인]
다음은 앞서 정밀하게 분석 및 추출된 학생의 생기부 채점 근거 JSON 데이터입니다. 
당신은 이 JSON 데이터만을 100% 신뢰하여 종합 총평을 작성해야 합니다. 
원본 생기부는 참고하지 마십시오. 오직 아래 JSON 데이터에 추출되어 있는 감점 내역(예: gradeDropsExtracted 배열 내용 등)과 획득 배열 내용만을 철저히 근거로 삼아 서술하십시오. 
(🚨특명: 1, 2, 3학년 어떠한 학기, 어떠한 과목이든 "성적이 누락/미산출되었다"는 사실 자체를 감점 요인이나 아쉬운 점으로 지적하거나 언급하는 행위를 전면 금지합니다. 시스템상 성적이 누락된 학기는 모두 만점(ALL A)으로 완벽하게 처리되었으므로, 이를 결함이나 아쉬운 점으로 서술해서는 절대로 안 됩니다.)
(🚨또한, JSON에 없는 기술·가정, 정보 등의 과목을 스스로 유추하여 감점으로 지적하는 행위를 절대 금지합니다.)

아래 지시된 내용을 모두 포함하여 자연스럽게 이어지는 하나의 단일 문자열로 작성할 것 (🚨JSON 파싱 에러 방지를 위해 줄바꿈 문자 \\n 등은 절대 사용 금지, 띄어쓰기로만 문장 구분). 먼저 제공된 JSON 내용을 바탕으로 [학업역량], [진로적합성], [인성] 3가지 영역별로 나누어 주요 감점 원인(부족한 심화 탐구 깊이나 치명적 약점)을 객관적이고 냉철하게 분석하여 서술할 것. 그 후, 앞서 서술한 감점 사항들을 바탕으로 최종적인 사정관의 [종합 총평]을 자연스럽게 결론짓듯이 서술할 것. (출력 예시: "학업역량 영역에서는 ~한 점이 아쉬우며, 진로적합성 영역에서는 ~부분이 감점 요인입니다. 인성 영역에서는 ~한 점이 보완되어야 합니다. [종합 총평] 이 학생은 전체적으로...")

반드시 아래 JSON 포맷을 유지하여 순수 JSON만 반환하십시오.
{
  "overallReport": ""
}
`;

    const areas = [
      { id: 1, prompt: PROMPT_AREA_1 },
      { id: 2, prompt: PROMPT_AREA_2 },
      { id: 3, prompt: PROMPT_AREA_3 }
    ];
    let finalParsedData = {};
      const models = ['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview'];
    let pendingAreas = [...areas];
    let lastError = null;
    const studentUserPrompt = "[학생명]: " + student.name + "\n[생기부 파싱 텍스트]:\n" + textToAnalyze;

    for (let attempt = 0; attempt < models.length; attempt++) {
      if (pendingAreas.length === 0) break;
      const currentModel = models[attempt];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

      const reqPromises = pendingAreas.map(area => {
        return fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: area.prompt }, { text: studentUserPrompt }] }],
            generationConfig: { temperature: 0, response_mime_type: "application/json", maxOutputTokens: 65536 },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          })
        }).then(res => res.json().then(data => ({ res, data, area })));
      });

      const responses = await Promise.allSettled(reqPromises);
      let nextPending = [];

      for (let i = 0; i < responses.length; i++) {
        const r = responses[i];
        const area = pendingAreas[i];
        if (r.status === 'fulfilled') {
          const { res, data } = r.value;
          let success = false;
          if (res.ok && data.candidates && data.candidates[0].content.parts[0].text) {
             try {
                let rawText = data.candidates[0].content.parts[0].text;
                const sIdx = rawText.indexOf('{');
                if (sIdx !== -1) {
                    let braceCount = 0;
                    let eIdx = -1;
                    for (let i = sIdx; i < rawText.length; i++) {
                        if (rawText[i] === '{') braceCount++;
                        else if (rawText[i] === '}') braceCount--;
                        if (braceCount === 0) {
                            eIdx = i;
                            break;
                        }
                    }
                    if (eIdx !== -1) rawText = rawText.substring(sIdx, eIdx + 1);
                }
                const chunk = JSON.parse(rawText);
                Object.assign(finalParsedData, chunk);
                success = true;
             } catch(e) {
                lastError = new Error('JSON Parsing Error in Area ' + area.id + ': ' + e.message);
             }
          } else {
             lastError = new Error('API Error in Area ' + area.id + ': ' + JSON.stringify(data));
          }
          if (!success) nextPending.push(area);
        } else {
          nextPending.push(area);
          lastError = new Error('Fetch failed: ' + r.reason.message);
        }
      }
      pendingAreas = nextPending;
    }

    if (pendingAreas.length > 0) {
      throw lastError || new Error('최대 재시도 횟수를 초과했습니다. 실패한 Area 개수: ' + pendingAreas.length);
    }

    const deduplicate = (arr) => arr ? [...new Set(arr)] : [];
    finalParsedData.mathSciBooksExtracted = deduplicate(finalParsedData.mathSciBooksExtracted);
    finalParsedData.generalBooksExtracted = deduplicate(finalParsedData.generalBooksExtracted);
    finalParsedData.mathSciAwardsExtracted = deduplicate(finalParsedData.mathSciAwardsExtracted);
    finalParsedData.totalAwardsExtracted = deduplicate(finalParsedData.totalAwardsExtracted);
    finalParsedData.mathResearchExtracted = deduplicate(finalParsedData.mathResearchExtracted);
    finalParsedData.sciResearchExtracted = deduplicate(finalParsedData.sciResearchExtracted);

    const stage2UserPrompt = "[학생 채점 근거 JSON 데이터]:\n" + JSON.stringify(finalParsedData, null, 2);
    let reportSuccess = false;
    
    for (let attempt = 0; attempt < models.length; attempt++) {
      const currentModel = models[attempt];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      try {
        const reportRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT_OVERALL_REPORT }, { text: stage2UserPrompt }] }],
            generationConfig: { temperature: 0, response_mime_type: "application/json", maxOutputTokens: 65536 },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          })
        });
        const reportData = await reportRes.json();
        if (reportRes.ok && reportData.candidates && reportData.candidates[0].content.parts[0].text) {
          let rawReport = reportData.candidates[0].content.parts[0].text;
          const sIdx = rawReport.indexOf('{');
          if (sIdx !== -1) {
              let braceCount = 0;
              let eIdx = -1;
              for (let i = sIdx; i < rawReport.length; i++) {
                  if (rawReport[i] === '{') braceCount++;
                  else if (rawReport[i] === '}') braceCount--;
                  if (braceCount === 0) {
                      eIdx = i;
                      break;
                  }
              }
              if (eIdx !== -1) rawReport = rawReport.substring(sIdx, eIdx + 1);
          }
          const parsedReport = JSON.parse(rawReport);
          finalParsedData.overallReport = parsedReport.overallReport || '';
          reportSuccess = true;
          break;
        } else {
          lastError = new Error('Report API Error: ' + JSON.stringify(reportData));
        }
      } catch(e) {
        lastError = new Error('Report Parsing Error: ' + e.message);
      }
    }
    
    if (!reportSuccess) {
      console.warn("총평 생성 실패. 빈값으로 진행합니다.", lastError);
      finalParsedData.overallReport = "";
    }

    const evaluation = calculateRecordScore(finalParsedData);
    const totalScore = evaluation.totalScore;
    const { area1, area2, area3 } = evaluation;

    let suitability = "서류 탈락 유력(지원 불가)";
    if (totalScore >= 305) suitability = "지원 매우 안정적(적극 권장)";
    else if (totalScore >= 280) suitability = "지원 다소 안정적(권장)";
    else if (totalScore >= 255) suitability = "지원 다소 불안정(소극 권장)";
    else if (totalScore >= 220) suitability = "지원 불안정(비권장)";
    
    const sName = student.student_name || student.name || '학생';
    const targetSchoolName = student.target_school || student.targetSchool || '';
    
    const dedupeGrades = (arr) => [...new Set(arr || [])];
    const mathGradesText = dedupeGrades(finalParsedData.mathGrades).join(' ');
    const sciGradesText = dedupeGrades(finalParsedData.sciGrades).join(' ');
    const expectedTerms = ['2-1', '2-2', '3-1'];
    let isMissing = false;
    expectedTerms.forEach(term => {
      if (!mathGradesText.includes(term) || !sciGradesText.includes(term)) isMissing = true;
    });
    const warningMsg = isMissing ? `> 🚨 **[주의] 생기부에 성적이 누락된 학기가 감지되어 해당 학기 성적을 만점(ALL A)으로 반영하여 산출한 점수입니다.**\n\n` : ``;

    const scoreHeader = `# 📄 ${sName} 학생 외고·국제고 입학 대비 생기부 정밀 평가 보고서\n\n` +
                  `> ℹ️ **[평가 기준 안내]** 3학년의 창의적 체험활동, 세부능력 및 특기사항, 행동특성 및 종합의견은 원서 제출 기간 전에 모두 파악할 수 없기에 미반영된 상태로 분석 및 산정된 점수이며, 지원 학교 적합도 역시 이 기준을 반영하였습니다.\n\n` +
                  warningMsg +
                        `### 🎯 영역별 채점 결과 요약\n` +
                        `* **학업역량 (210점 만점)**: ${area1} 점\n` +
                        `* **진로적합성 (75점 만점)**: ${area2} 점\n` +
                        `* **인성 (115점 만점)**: ${area3} 점\n` +
                        `* **🔥 종합 생기부 평가 점수**: ${totalScore} 점 / 400점 만점\n` +
                        `* **🚀 지원 학교 적합도**: ${suitability}\n\n---\n`;    
                        
    let overallText = finalParsedData.overallReport || "총평 데이터가 없습니다.";
    let legacyReport = "\n---\n## 🏁 사정관 종합 총평\n" + overallText + "\n\n";
    legacyReport += "<!-- ADMIN_ONLY_START -->\n---\n## 🔍 관리자 전용: 30개 세부 항목별 채점 근거 및 분석\n\n";
    
    try {
      const Object = window.Object || global.Object;
      const Array = window.Array || global.Array;
      const String = window.String || global.String;
      const JSON = window.JSON || global.JSON;
      const cards = generateScoreCardsData(finalParsedData, evaluation.scores);
      cards.forEach((c, idx) => {
        legacyReport += `### [항목 ${idx + 1}] ${c.title.replace(/^\d+\.\s*/, '')}\n`;
        legacyReport += `- **판정 결과 및 획득 점수**: ${c.score} / ${c.max} 점\n`;
        legacyReport += `- **판정 근거 및 증거 문장**:\n`;
        if (Array.isArray(c.quote) && c.quote.length > 0) {
          legacyReport += c.quote.map(q => `> "${q}"`).join('\n') + '\n';
        } else {
          legacyReport += `> 기록 없음\n`;
        }
        legacyReport += `- **사정관 상세 분석**: ${c.desc}\n\n`;
      });
    } catch(e) {
      legacyReport += "문항별 점수 파싱 중 오류 발생\n\n";
    }
    legacyReport += "<!-- ADMIN_ONLY_END -->\n\n---\n";
    legacyReport += "## ⚙️ SYSTEM_DATA (프론트엔드 연동용 JSON 파라미터)\n\n```json\n";
    legacyReport += JSON.stringify(finalParsedData, null, 2);
    legacyReport += "\n```\n";

    const analysisText = scoreHeader + legacyReport;

    // record_basis 안전 저장 (SELECT -> UPDATE or INSERT)
    const { data: existingBasis } = await window.supabaseClient.from('record_basis').select('id').eq('student_link', effectiveLink).maybeSingle();
    const basisPayload = {
      student_link: effectiveLink,
      target_school: targetSchoolName,
      total_score: String(totalScore),
      analysis_report: analysisText,
      score_details_json: typeof finalParsedData === 'string' ? finalParsedData : JSON.stringify(finalParsedData),
      created_at: new Date().toISOString()
    };

    let basisErr;
    if (existingBasis && existingBasis.id) {
      const res = await window.supabaseClient.from('record_basis').update(basisPayload).eq('id', existingBasis.id);
      basisErr = res.error;
    } else {
      const res = await window.supabaseClient.from('record_basis').insert(basisPayload);
      basisErr = res.error;
    }

    if (basisErr) {
      console.error('record_basis DB 저장 오류:', basisErr);
      throw new Error('record_basis DB 저장 실패: ' + basisErr.message);
    }
    const displayScore = isMissing ? `${totalScore} 🚨` : String(totalScore);
    const { error: studentScoreErr } = await window.supabaseClient.from('students').update({ record_score_ai: displayScore }).eq('id', student.id);
    if (studentScoreErr) console.error('students score update error:', studentScoreErr);

    return { success: true, score: totalScore, analysisReport: analysisText, scoreDetails: finalParsedData };
  } catch (err) {
    throw err;
  }
}

/**
 * 순수 파싱 로직 (PDF -> OCR 텍스트 추출 후 캐시 저장)
 */
async function parseStudentRecord(payload) {
  try {
    const studentId = payload.studentId || payload;
    let { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentId).maybeSingle();
    if (!student) {
      const { data: studentById } = await window.supabaseClient.from('students').select('*').eq('id', studentId).maybeSingle();
      student = studentById;
    }
    if (!student) throw new Error('학생 정보를 수파베이스에서 찾을 수 없습니다.');
    
    const effectiveLink = student.student_link || student.id;
    if (!student.record_link || (!student.record_link.startsWith('http://') && !student.record_link.startsWith('https://'))) {
      throw new Error('유효한 생기부 PDF 링크가 없습니다. 구글 드라이브에 파일을 업로드해주세요.');
    }

    const textToAnalyze = await extractTextFromPdf(student.record_link);
    if (!textToAnalyze || textToAnalyze.length < 100) {
      throw new Error('파싱된 텍스트가 너무 짧거나 추출에 실패했습니다.');
    }

    const { data: existingParsed } = await window.supabaseClient.from('parsed_records').select('id').eq('student_link', effectiveLink).maybeSingle();
    let prErr;
    if (existingParsed && existingParsed.id) {
      const res = await window.supabaseClient.from('parsed_records').update({ parsed_content: textToAnalyze }).eq('id', existingParsed.id);
      prErr = res.error;
    } else {
      const res = await window.supabaseClient.from('parsed_records').insert({ student_link: effectiveLink, student_name: student.student_name || student.name || '', parsed_content: textToAnalyze });
      prErr = res.error;
    }
    
    if (prErr) {
      throw new Error('파싱 텍스트 캐시 저장에 실패했습니다: ' + prErr.message);
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * PDF 텍스트 추출 모듈 (extractTextFromPdf)
 */
async function extractTextFromPdf(fileUrl) {
  try {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error('파일을 다운로드 할 수 없습니다.');
    const blob = await fileRes.blob();
    
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const { data: settings } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'GeminiKey').single();
    const apiKey = settings ? settings.setting_value : '';
    if (!apiKey) throw new Error('Gemini API 키가 수파베이스 settings 테이블에 설정되지 않았습니다.');
    
    const { data: pdfPromptData } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'prompt_pdf').single();
    const prompt = pdfPromptData ? pdfPromptData.setting_value : "생활기록부 PDF 문서를 분석하여 텍스트로 추출하라.";
    
    const models = ['gemini-3.7-flash', 'gemini-3.6-flash'];
    let lastError = null;
    
    for (let i = 0; i < models.length; i++) {
      const currentModel = models[i];
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "application/pdf", data: base64Data } }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 65536 },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        })
      });
      
      if (response.ok) {
        const responseData = await response.json();
        if (responseData.candidates && responseData.candidates.length > 0) {
          const candidate = responseData.candidates[0];
          // 안전 필터(SAFETY) 작동 여부 감지 및 방어 코드
          if (candidate.finishReason === 'SAFETY') {
            console.warn('안전 필터에 의해 차단되었습니다.', candidate.safetyRatings);
            lastError = new Error(`${currentModel} API 차단: 안전 필터 발동`);
            continue; // 차단 시 즉시 뻗지 않고 다음 모델로 재시도
          }
          // content 및 parts 속성이 안전하게 존재하는지 확인
          if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            return candidate.content.parts[0].text;
          }
        }
      }
      lastError = new Error(`${currentModel} API 호출 실패 (상태 코드: ${response.status})`);
    }
    throw lastError;
  } catch (e) {
    throw new Error("PDF 텍스트 추출 중 오류가 발생했습니다: " + e.message);
  }
}

/**
 * 생기부 PDF 업로드 API (Supabase Storage 연동)
 */
async function uploadStudentRecordPdf(studentId, fileObject, fileName) {
  try {
    let { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentId).maybeSingle();
    if (!student) {
      const { data: studentById } = await window.supabaseClient.from('students').select('*').eq('id', studentId).maybeSingle();
      student = studentById;
    }
    if (!student) throw new Error('학생을 찾을 수 없습니다.');
    
    const sName = student.student_name || '이름없음';
    const sCenter = student.center_name || '센터없음';
    let effectiveLink = student.student_link;
    if (!effectiveLink) {
      // 12자리 예쁜 고유 식별 코드 생성 (긴 UUID 대신 일통된 짧은 길이 유지)
      effectiveLink = Math.random().toString(36).substring(2, 14);
    }
    // RLS 정책(UPDATE 권한 누락) 충돌을 방지하기 위해 파일명에 타임스탬프를 부여하여 항상 INSERT가 일어나도록 강제합니다.
    const newFileName = `record_${effectiveLink}_${Date.now()}.pdf`;
    
    const { data, error } = await window.supabaseClient.storage.from('student_records').upload(newFileName, fileObject, {
      contentType: 'application/pdf',
      upsert: false
    });
    
    if (error) throw error;
    
    const { data: publicUrlData } = window.supabaseClient.storage.from('student_records').getPublicUrl(newFileName);
    const fileUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    
    const updateObj = { record_link: fileUrl };
    if (effectiveLink) {
      updateObj.student_link = effectiveLink;
    }
    
    let { error: updateErr } = await window.supabaseClient.from('students').update(updateObj).eq('id', student.id);
    if (updateErr) {
      console.warn('Update with student_link failed, retrying record_link only:', updateErr);
      const { error: retryErr } = await window.supabaseClient.from('students').update({ record_link: fileUrl }).eq('id', student.id);
      if (retryErr) {
        throw new Error('DB 레코드 링크 갱신 실패: ' + retryErr.message);
      }
    }
    
    return { success: true, url: fileUrl };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function calculateRecordScore(data) {
  const scores = {};
  
  // 강제 중복 제거 유틸
  const dedupe = (arr) => [...new Set(arr || [])];
  
  // [영역 1] 학업역량 (210점 만점)
  const mathGrades = dedupe(data.mathGrades);
  let mathPenalty = 0;
  mathGrades.forEach(g => {
    if (String(g).includes('B')) mathPenalty += 15;
    else if (String(g).includes('C')) mathPenalty += 20;
    else if (String(g).includes('D') || String(g).includes('E')) mathPenalty += 25;
  });
  scores.area1_item1 = Math.max(0, 40 - mathPenalty);

  const sciGrades = dedupe(data.sciGrades);
  let sciPenalty = 0;
  sciGrades.forEach(g => {
    if (String(g).includes('B')) sciPenalty += 15;
    else if (String(g).includes('C')) sciPenalty += 20;
    else if (String(g).includes('D') || String(g).includes('E')) sciPenalty += 25;
  });
  scores.area1_item2 = Math.max(0, 40 - sciPenalty);

  const drops = data.gradeDropsExtracted || { korEng: [], socHisInfo: [], moralTech: [] };
  
  const calcDrops = (arr) => {
    let totalDrops = 0;
    dedupe(arr).forEach(str => {
      if (String(str).includes('누락')) return;
      const match = String(str).match(/[BCDE]/);
      if (match) {
        if (match[0] === 'B') totalDrops += 1;
        else if (match[0] === 'C') totalDrops += 2;
        else if (match[0] === 'D') totalDrops += 3;
        else if (match[0] === 'E') totalDrops += 4;
      }
    });
    return totalDrops;
  };

  const dropsKorEng = calcDrops(drops.korEng);
  const dropsSocHisInfo = calcDrops(drops.socHisInfo);
  const dropsMoralTech = calcDrops(drops.moralTech);
  
  scores.area1_item3 = Math.max(0, 25 - (dropsKorEng * 10) - (dropsSocHisInfo * 5) - (dropsMoralTech * 3));

  scores.area1_item4 = Math.min(10, dedupe(data.mathSciClubsExtracted).length * 2);
  scores.area1_item5 = Math.min(10, dedupe(data.totalAwardsExtracted.filter(a => !a.includes('교과'))).length * 2);
  scores.area1_item6 = Math.min(10, dedupe(data.mathSciAwardsExtracted.filter(a => !a.includes('교과'))).length * 4);
  scores.area1_item7 = Math.min(10, dedupe(data.mathResearchExtracted).length * 2);
  scores.area1_item8 = Math.min(10, dedupe(data.sciResearchExtracted).length * 2);
  scores.area1_item9 = Math.min(10, dedupe(data.mathSciBooksExtracted).length * 2);

  const evalSeteuk = (seteukObj) => {
    let s = 0;
    for (let term in (seteukObj || {})) {
      const termData = seteukObj[term];
      const pCnt = dedupe(termData.deepArr).length;
      const nCnt = dedupe(termData.basicArr).length;
      const negCnt = dedupe(termData.negativeArr).length;
      let termScore = (pCnt * 2) + (nCnt * 1) - (negCnt * 1);
      if (termScore < 0) termScore = 0;
      if (termScore > 4) termScore = 4;
      s += termScore;
    }
    return s;
  };
  scores.area1_item10 = Math.min(15, evalSeteuk(data.mathSeteukExtracted));
  scores.area1_item11 = Math.min(15, evalSeteuk(data.sciSeteukExtracted));

  const evalBehavior = (behObj) => {
    let s = 0;
    for (let year in (behObj || {})) {
      const termData = behObj[year];
      const pCnt = dedupe(termData.giftedArr).length;
      const nCnt = dedupe(termData.excellentArr).length;
      let yearScore = 0;
      if (pCnt === 0 && nCnt === 0) {
        yearScore = 1;
      } else {
        yearScore = (pCnt * 5) + (nCnt * 3);
      }
      if (yearScore > 8) yearScore = 8;
      s += yearScore;
    }
    return s;
  };
  scores.area1_item12 = Math.min(15, evalBehavior(data.mathSciBehaviorExtracted));

  // [영역 2] 진로적합성 (75점 만점)
  const careerGoals = dedupe(data.careerGoalsExtracted);
  scores.area2_item1 = Math.min(5, careerGoals.length * 3);

  scores.area2_item2 = Math.min(15, dedupe(data.interestMentionsExtracted).length * 1);

  const evalRecommend = (recObj) => {
    let s = 0;
    for (let term in (recObj || {})) {
      const termData = recObj[term];
      const pCnt = dedupe(termData.topRecArr).length;
      const nCnt = dedupe(termData.goodRecArr).length;
      let termScore = 0;
      if (pCnt > 0) termScore += 3;
      if (nCnt > 0) termScore += 2;
      if (termScore > 4) termScore = 4;
      s += termScore;
    }
    return s;
  };
  scores.area2_item3 = Math.min(15, evalRecommend(data.mathRecommendExtracted));
  scores.area2_item4 = Math.min(15, evalRecommend(data.sciRecommendExtracted));
  scores.area2_item5 = Math.min(15, evalRecommend(data.infoRecommendExtracted));

  const evalStudyAttitude = (attObj) => {
    let s = 0;
    for (let year in (attObj || {})) {
      const termData = attObj[year];
      const pCnt = dedupe(termData.proactiveArr).length;
      const nCnt = dedupe(termData.sincereArr).length;
      let yearScore = 0;
      if (pCnt === 0 && nCnt === 0) {
        yearScore = 1;
      } else {
        yearScore = (pCnt * 5) + (nCnt * 3);
      }
      if (yearScore > 5) yearScore = 5;
      s += yearScore;
    }
    return s;
  };
  scores.area2_item6 = Math.min(10, evalStudyAttitude(data.studyAttitudeExtracted));

  // [영역 3] 인성 (115점 만점)
  scores.area3_item1 = Math.min(10, dedupe(data.groupProjectsExtracted).length * 2);
  scores.area3_item2 = Math.min(10, dedupe(data.logicDebatesExtracted).length * 2);
  scores.area3_item3 = Math.min(10, dedupe(data.helpSharingExtracted).length * 2);
  scores.area3_item4 = Math.min(10, dedupe(data.leadershipExtracted).length * 2);
  scores.area3_item5 = Math.min(10, dedupe(data.ruleComplianceExtracted).length * 2);

  const att = data.attendanceExtracted || {};
  let attendancePenalty = 0;
  attendancePenalty += (att.unexcusedAbsences || 0) * 10;
  attendancePenalty += (att.unexcusedLates || 0) * 5;
  attendancePenalty += (att.unexcusedEarlyLeaves || 0) * 3;
  attendancePenalty += (att.otherAbsences || 0) * 2;
  scores.area3_item6 = Math.max(0, 20 - attendancePenalty);

  scores.area3_item7 = Math.min(10, dedupe(data.generalBooksExtracted).length * 1);

  const volunteerHours = dedupe(data.volunteerHoursExtracted);
  let volunteerScore = 0;
  volunteerHours.forEach(hrs => {
    if (hrs >= 30) volunteerScore += 5;
    else if (hrs >= 20) volunteerScore += 3;
    else volunteerScore += 1;
  });
  scores.area3_item8 = Math.min(10, volunteerScore);

  scores.area3_item9 = Math.min(5, dedupe(data.artsSportsExtracted).length * 2);
  scores.area3_item10 = Math.min(10, dedupe(data.leadershipRolesExtracted).length * 2);

  const evalPeer = (peerObj) => {
    let s = 0;
    for (let year in (peerObj || {})) {
      const termData = peerObj[year];
      if (dedupe(termData.altruisticArr).length > 0) s += 5;
      else if (dedupe(termData.friendlyArr).length > 0) s += 3;
      else s += 2;
    }
    return s;
  };
  scores.area3_item11 = Math.min(10, evalPeer(data.peerRelationsExtracted));

  const neg = data.negativeCharacterExtracted || {};
  let negativePenalty = 0;
  negativePenalty += dedupe(neg.fatalArr).length * 30;
  negativePenalty += dedupe(neg.highArr).length * 7;
  negativePenalty += dedupe(neg.midArr).length * 5;
  negativePenalty += dedupe(neg.lowArr).length * 3;
  scores.area3_item12 = -Math.min(35, negativePenalty);

  const area1 = scores.area1_item1 + scores.area1_item2 + scores.area1_item3 + 
                scores.area1_item4 + scores.area1_item5 + scores.area1_item6 + 
                scores.area1_item7 + scores.area1_item8 + scores.area1_item9 + 
                scores.area1_item10 + scores.area1_item11 + scores.area1_item12;

  const area2 = scores.area2_item1 + scores.area2_item2 + scores.area2_item3 + 
                scores.area2_item4 + scores.area2_item5 + scores.area2_item6;

  const area3 = scores.area3_item1 + scores.area3_item2 + scores.area3_item3 + 
                scores.area3_item4 + scores.area3_item5 + scores.area3_item6 + 
                scores.area3_item7 + scores.area3_item8 + scores.area3_item9 + 
                scores.area3_item10 + scores.area3_item11 + scores.area3_item12;

  const totalScore = area1 + area2 + area3;

  return { totalScore: totalScore, scores: scores, area1, area2, area3 };
}

function generateScoreCardsData(d, scores, role = '관리자') {
  const getArrText = (arr) => {
    if (!arr || arr.length === 0) return [];
    return [...new Set(arr)];
  };
  const count = (val) => {
    if (!val) return 0;
    let arr = Array.isArray(val) ? val : [val];
    return [...new Set(arr)].length;
  };
  const getNestedArrText = (obj, scorerFn) => {
    let list = [];
    if (!obj) return list;
    for (let k in obj) {
       if (scorerFn) {
           const isSemester = k.includes('-');
           const suffix = isSemester ? '학기' : '학년';
           if (role === '관리자') {
               const subtotal = scorerFn(obj[k]);
               list.push(`[${k}${suffix}] 소계 ${subtotal}점`);
           } else {
               list.push(`[${k}${suffix}]`);
           }
       }
       // 상(탁월) 매핑
       const topKeys = ['praiseArr', 'deepArr', 'giftedArr', 'topRecArr', 'proactiveArr', 'altruisticArr'];
       topKeys.forEach(key => {
         if (obj[k][key]) {
           let arr = Array.isArray(obj[k][key]) ? obj[k][key] : [obj[k][key]];
           arr.forEach(t => list.push('[상(탁월)] ' + t));
         }
       });
       
       // 중(일반) 매핑 (basicArr 포함)
       const midKeys = ['normalArr', 'basicArr', 'excellentArr', 'goodRecArr', 'sincereArr', 'friendlyArr'];
       midKeys.forEach(key => {
         if (obj[k][key]) {
           let arr = Array.isArray(obj[k][key]) ? obj[k][key] : [obj[k][key]];
           arr.forEach(t => list.push('[중(일반)] ' + t));
         }
       });

       // 하(미흡) 매핑
       const lowKeys = ['negativeArr'];
       lowKeys.forEach(key => {
         if (obj[k][key]) {
           let arr = Array.isArray(obj[k][key]) ? obj[k][key] : [obj[k][key]];
           arr.forEach(t => list.push('[하(미흡)] ' + t));
         }
       });
       
       if (Array.isArray(obj[k])) list.push(...obj[k]);
    }
    return [...new Set(list)];
  };
  const getDropText = (obj) => {
    if (!obj) return [];
    let list = [];
    if (obj.korEng) list.push(...obj.korEng);
    if (obj.socHisInfo) list.push(...obj.socHisInfo);
    if (obj.moralTech) list.push(...obj.moralTech);
    return [...new Set(list)].map(str => {
      if (String(str).includes('누락')) {
        return String(str).replace(/누락/g, '미산출 (만점 반영)');
      }
      return str;
    });
  };

  const specs = [
    { key: 'area1_item1', range: '🔍 탐색 범위: 교과학습발달상황(성취도) 표 전체 (1, 2, 3학년 총 3개 학년)', title: '1. 최근 3학기 수학 성취도', max: 40, desc: 'B등급 -15점, C등급 -20점, D/E등급 -25점', getQuote: (d) => {
        let arr = getArrText(d.mathGrades);
        const expected = ['2-1', '2-2', '3-1'];
        let textJoined = arr.join(' ');
        expected.forEach(term => {
          if (!textJoined.includes(term)) arr.push(`${term}학기 미산출 (만점 반영)`);
        });
        return arr;
    } },
    { key: 'area1_item2', range: '🔍 탐색 범위: 교과학습발달상황(성취도) 표 전체 (1, 2, 3학년 총 3개 학년)', title: '2. 최근 3학기 과학 성취도', max: 40, desc: 'B등급 -15점, C등급 -20점, D/E등급 -25점', getQuote: (d) => {
        let arr = getArrText(d.sciGrades);
        const expected = ['2-1', '2-2', '3-1'];
        let textJoined = arr.join(' ');
        expected.forEach(term => {
          if (!textJoined.includes(term)) arr.push(`${term}학기 미산출 (만점 반영)`);
        });
        return arr;
    } },
    { key: 'area1_item3', range: '🔍 탐색 범위: 교과학습발달상황(성취도) 표 전체 (1, 2, 3학년 총 3개 학년)', title: '3. 주요과목 등급 유지도', max: 25, desc: '국/영 -10점, 사/역/정 -5점, 도덕/기가 -3점 (1회당)', getQuote: (d) => getDropText(d.gradeDropsExtracted) },
    { key: 'area1_item4', range: '🔍 탐색 범위: 창의적 체험활동 중 동아리활동 (1, 2, 3학년 총 3개 학년)', title: '4. 수/과학 관련 동아리', max: 10, desc: '동아리 개수당 2점 가산', getQuote: (d) => getArrText(d.mathSciClubsExtracted) },
    { key: 'area1_item5', range: '🔍 탐색 범위: 수상경력 표 전체 (1, 2, 3학년 총 3개 학년)', title: '5. 학기당 수상 실적', max: 10, desc: '실적당 2점 가산 (교과상 제외)', getQuote: (d) => getArrText(d.totalAwardsExtracted) },
    { key: 'area1_item6', range: '🔍 탐색 범위: 수상경력 표 전체 (1, 2, 3학년 총 3개 학년)', title: '6. 수/과학 관련 수상', max: 10, desc: '실적당 4점 가산 (최대 10점)', getQuote: (d) => getArrText(d.mathSciAwardsExtracted) },
    { key: 'area1_item7', range: '🔍 탐색 범위: 교과세특 및 창의적체험활동(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '7. 수학 탐구 주제 명기', max: 10, desc: '주제 언급당 2점 가산', getQuote: (d) => getArrText(d.mathResearchExtracted) },
    { key: 'area1_item8', range: '🔍 탐색 범위: 교과세특 및 창의적체험활동(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '8. 과학 탐구 주제 명기', max: 10, desc: '주제 언급당 2점 가산', getQuote: (d) => getArrText(d.sciResearchExtracted) },
    { key: 'area1_item9', range: '🔍 탐색 범위: 독서활동상황 표 전체 (1, 2, 3학년 총 3개 학년)', title: '9. 수/과학 독서활동', max: 10, desc: '권당 2점 가산', getQuote: (d) => getArrText(d.mathSciBooksExtracted) },
    { key: 'area1_item10', range: '🔍 탐색 범위: 교과학습발달상황(세부능력 및 특기사항) 내 수학 교과 (1-1, 1-2, 2-1, 2-2 총 4개 학기)', title: '10. 수학 세특 교과우수성', max: 15, desc: '학기별 합산 (상:+2점, 중:+1점, 하:-1점) / 최대 15점 (학기별 최대 4점)', getQuote: (d) => getNestedArrText(d.mathSeteukExtracted, (v) => Math.min(4, count(v.deepArr)*2 + count(v.basicArr)*1 - count(v.negativeArr)*1)) },
    { key: 'area1_item11', range: '🔍 탐색 범위: 교과학습발달상황(세부능력 및 특기사항) 내 과학 교과 (1-1, 1-2, 2-1, 2-2 총 4개 학기)', title: '11. 과학 세특 교과우수성', max: 15, desc: '학기별 합산 (상:+2점, 중:+1점, 하:-1점) / 최대 15점 (학기별 최대 4점)', getQuote: (d) => getNestedArrText(d.sciSeteukExtracted, (v) => Math.min(4, count(v.deepArr)*2 + count(v.basicArr)*1 - count(v.negativeArr)*1)) },
    { key: 'area1_item12', range: '🔍 탐색 범위: 행동특성 및 종합의견 전체 (1, 2학년 총 2개 학년)', title: '12. 행특 수/과학 행동특성', max: 15, desc: '학년별 합산 (영재성:+5점, 우수성:+3점, 기본:+1점) / 최대 15점 (학년별 최대 8점)', getQuote: (d) => getNestedArrText(d.mathSciBehaviorExtracted, (v) => { let p = count(v.giftedArr), n = count(v.excellentArr); return Math.min(8, (p === 0 && n === 0) ? 1 : p*5 + n*3); }) },
    
    { key: 'area2_item1', range: '🔍 탐색 범위: 진로희망상황 표 전체 (1, 2, 3학년 총 3개 학년)', title: '13. 진로희망 일치성', max: 5, desc: '일치 연수당 3점 가산 (최대 5점)', getQuote: (d) => getArrText(d.careerGoalsExtracted) },
    { key: 'area2_item2', range: '🔍 탐색 범위: 창의적 체험활동 중 진로 및 동아리활동 (1, 2, 3학년 총 3개 학년)', title: '14. 진로활동 수/과학 연계', max: 15, desc: '연계 언급 1회당 1점 가산 (최대 15점)', getQuote: (d) => getArrText(d.interestMentionsExtracted) },
    { key: 'area2_item3', range: '🔍 탐색 범위: 교과학습발달상황(세부능력 및 특기사항) 내 수학 교과 (1-1, 1-2, 2-1, 2-2 총 4개 학기)', title: '15. 수학 교사 추천 등급', max: 15, desc: '학기별 합산 (적극추천:+3점, 일반추천:+2점) / 최대 15점 (학기별 최대 4점)', getQuote: (d) => getNestedArrText(d.mathRecommendExtracted, (v) => { let s=0; if(count(v.topRecArr)>0) s+=3; if(count(v.goodRecArr)>0) s+=2; return Math.min(4, s); }) },
    { key: 'area2_item4', range: '🔍 탐색 범위: 교과학습발달상황(세부능력 및 특기사항) 내 과학 교과 (1-1, 1-2, 2-1, 2-2 총 4개 학기)', title: '16. 과학 교사 추천 등급', max: 15, desc: '학기별 합산 (적극추천:+3점, 일반추천:+2점) / 최대 15점 (학기별 최대 4점)', getQuote: (d) => getNestedArrText(d.sciRecommendExtracted, (v) => { let s=0; if(count(v.topRecArr)>0) s+=3; if(count(v.goodRecArr)>0) s+=2; return Math.min(4, s); }) },
    { key: 'area2_item5', range: '🔍 탐색 범위: 교과학습발달상황(세부능력 및 특기사항) 내 정보 및 기타 과목 (1-1, 1-2, 2-1, 2-2 총 4개 학기)', title: '17. 정보/기타 교사 추천', max: 15, desc: '학기별 합산 (적극추천:+3점, 일반추천:+2점) / 최대 15점 (학기별 최대 4점)', getQuote: (d) => getNestedArrText(d.infoRecommendExtracted, (v) => { let s=0; if(count(v.topRecArr)>0) s+=3; if(count(v.goodRecArr)>0) s+=2; return Math.min(4, s); }) },
    { key: 'area2_item6', range: '🔍 탐색 범위: 행동특성 및 종합의견 전체 (1, 2학년 총 2개 학년)', title: '18. 탐구태도 우수성', max: 10, desc: '학년별 합산 (주도적:+5점, 성실함:+3점, 기본:+1점) / 최대 10점 (학년별 최대 5점)', getQuote: (d) => getNestedArrText(d.studyAttitudeExtracted, (v) => { let p = count(v.proactiveArr), n = count(v.sincereArr); return Math.min(5, (p === 0 && n === 0) ? 1 : p*5 + n*3); }) },
    
    { key: 'area3_item1', range: '🔍 탐색 범위: 자유학기(1-1), 창체 및 교과세특(수학/과학 제외)(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '19. 협업/공동체 활동', max: 10, desc: '활동 언급당 2점 가산', getQuote: (d) => getArrText(d.groupProjectsExtracted) },
    { key: 'area3_item2', range: '🔍 탐색 범위: 자유학기(1-1), 창체 및 교과세특(수학/과학 제외)(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '20. 의사소통/토론', max: 10, desc: '활동 언급당 2점 가산', getQuote: (d) => getArrText(d.logicDebatesExtracted) },
    { key: 'area3_item3', range: '🔍 탐색 범위: 자유학기(1-1), 창체 및 교과세특(수학/과학 제외)(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '21. 나눔/배려/봉사', max: 10, desc: '활동 언급당 2점 가산', getQuote: (d) => getArrText(d.helpSharingExtracted) },
    { key: 'area3_item4', range: '🔍 탐색 범위: 자유학기(1-1), 창체 및 교과세특(수학/과학 제외)(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '22. 리더십 역량', max: 10, desc: '리더십 언급당 2점 가산', getQuote: (d) => getArrText(d.leadershipExtracted) },
    { key: 'area3_item5', range: '🔍 탐색 범위: 자유학기(1-1), 창체 및 교과세특(수학/과학 제외)(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '23. 규칙 준수/성실성', max: 10, desc: '준수 언급당 2점 가산', getQuote: (d) => getArrText(d.ruleComplianceExtracted) },
    { key: 'area3_item6', range: '🔍 탐색 범위: 출결상황 표 전체 (1, 2, 3학년 총 3개 학년)', title: '24. 출결 상태 성실성', max: 20, desc: '미인정결석 -10점, 지각 -5점, 조퇴/결과 -3점, 기타결석 -2점', getQuote: (d) => {
        const att = d.attendanceExtracted || {};
        let result = [];
        if (att.unexcusedAbsences) result.push(`미인정결석: ${att.unexcusedAbsences}회`);
        if (att.unexcusedLates) result.push(`미인정지각: ${att.unexcusedLates}회`);
        if (att.unexcusedEarlyLeaves) result.push(`미인정조퇴및결과: ${att.unexcusedEarlyLeaves}회`);
        if (att.otherAbsences) result.push(`기타결석: ${att.otherAbsences}회`);
        return result.length ? result : [`특이사항 없음`];
    } },
    { key: 'area3_item7', range: '🔍 탐색 범위: 독서활동상황 표 전체 (1, 2, 3학년 총 3개 학년)', title: '25. 인문/일반 독서활동', max: 10, desc: '권당 1점 가산 (최대 10점)', getQuote: (d) => getArrText(d.generalBooksExtracted) },
    { key: 'area3_item8', range: '🔍 탐색 범위: 창의적 체험활동 중 봉사활동 (1, 2학년 총 2개 학년)', title: '26. 봉사활동 시간 충족도', max: 10, desc: '30시간 이상 5점, 20시간 이상 3점, 그외 1점', getQuote: (d) => getArrText(d.volunteerHoursExtracted).map(v => v + "시간") },
    { key: 'area3_item9', range: '🔍 탐색 범위: 창의적 체험활동 전체 (1, 2, 3학년 총 3개 학년)', title: '27. 예체능 활동 참여도', max: 5, desc: '활동 언급당 2점 가산 (최대 5점)', getQuote: (d) => getArrText(d.artsSportsExtracted) },
    { key: 'area3_item10', range: '🔍 탐색 범위: 창의적체험활동(1-1, 1-2, 2-1, 2-2 총 4개 학기), 행발(1, 2학년 총 2개 학년)', title: '28. 학생회/임원 활동', max: 10, desc: '학기당 2점 가산', getQuote: (d) => getArrText(d.leadershipRolesExtracted) },
    { key: 'area3_item11', range: '🔍 탐색 범위: 행동특성 및 종합의견 전체 (1, 2학년 총 2개 학년)', title: '29. 교우 관계 및 사회성', max: 10, desc: '학년별 합산 (이타성: 5점, 원만함: 3점, 기본: 2점) / 최대 10점', getQuote: (d) => getNestedArrText(d.peerRelationsExtracted, (v) => { if(count(v.altruisticArr)>0) return 5; if(count(v.friendlyArr)>0) return 3; return 2; }) },
    { key: 'area3_item12', range: '🔍 탐색 범위: 학교폭력 조치상황 및 생기부 전체 텍스트', title: '30. 부정적 평가 감점', max: 0, desc: '학교폭력 -30점, 치명적 -7점, 보통 -5점, 경미 -3점 (최대 -35점)', getQuote: (d) => getNestedArrText(d.negativeCharacterExtracted) }
  ];
  
  return specs.map(spec => ({
    title: spec.title,
    max: spec.max,
    score: scores[spec.key] !== undefined ? scores[spec.key] : 0,
    desc: spec.desc,
    quote: spec.getQuote(d)
  }));
}


// 브라우저 전역 접근용 Export
if (typeof window !== 'undefined') {
  window.backendLogic = {
    generateAIFeedback,
    generateAIQuestions,
    evaluateStudentRecord,
    extractTextFromPdf,
    uploadStudentRecordPdf,
    calculateRecordScore
  };
}


// ----------------------------------------------------------------------
// 🚨 [누락된 기본 API 함수 긴급 복구] 🚨
// ----------------------------------------------------------------------

// 로그인 인증
async function verifyPassword(payload) {
  try {
    const pwd = payload.password || payload;
    
    const { data: adminSetting } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', '관리자').single();
    const { data: teacherSetting } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', '교사').single();
    
    if (!adminSetting && !teacherSetting) return { success: false, error: 'DB에 설정된 비밀번호가 없습니다.' };
    
    if (adminSetting && adminSetting.setting_value === pwd) return { success: true, role: '관리자' };
    if (teacherSetting && teacherSetting.setting_value === pwd) return { success: true, role: '교사' };
    
    return { success: false, error: '비밀번호가 올바르지 않습니다.' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// 환경설정 로드
async function getSettings() {
  try {
    const { data: settings } = await window.supabaseClient.from('settings').select('*');
    const basic = {};
    let schools = [];

    if (settings) {
      settings.forEach(s => { 
        if (s.setting_key === 'schools') {
          try { schools = JSON.parse(s.setting_value); } catch(e){}
        } else if (s.setting_key === 'TargetSchools') {
          // schools가 비어있을 때만 TargetSchools를 로드하여 덮어쓰기 방지
          if (!schools || schools.length === 0) {
            try { schools = JSON.parse(s.setting_value); } catch(e){}
          }
        } else {
          basic[s.setting_key] = s.setting_value;
        }
      });
    }

    if (!schools || schools.length === 0) {
      const { data: qRows } = await window.supabaseClient.from('school_questions').select('*').order('school_name').order('item_no');
      const schoolMap = {};
      if (qRows) {
        qRows.forEach(r => {
          if (!schoolMap[r.school_name]) schoolMap[r.school_name] = [];
          schoolMap[r.school_name].push({ label: r.item_no, content: r.content, limit: String(r.limit_chars || 0) });
        });
      }
      schools = Object.keys(schoolMap).map(sName => ({ name: sName, questions: schoolMap[sName] }));
    }

    return { success: true, basic, schools };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function getStudentsList() {
    try {
      const { data: students } = await window.supabaseClient.from('students').select('*');
      if (!students) return [];
      
      const { data: practices } = await window.supabaseClient.from('interview_practice').select('student_link, answers_json');
      const practiceMap = {};
      if (practices) {
        practices.forEach(p => {
          practiceMap[p.student_link] = p.answers_json || '';
        });
      }
      
      // 🗂️ 수파베이스 Storage 버킷(생기부 폴더)에 실제 파일이 존재하는지 1회 단일 조회로 교차 검증
      let existingFileSet = new Set();
      try {
        const { data: storageFiles } = await window.supabaseClient.storage.from('student_records').list('', { limit: 1000 });
        if (storageFiles) {
          storageFiles.forEach(f => existingFileSet.add(f.name));
        }
      } catch (e) {
        console.warn('Storage file list fetch error:', e);
      }
      // 📝 파싱 이력 유무 교차 검증 (프론트엔드 버튼 동적 렌더링용)
      const { data: parsedRecords } = await window.supabaseClient.from('parsed_records').select('student_link');
      const parsedSet = new Set();
      if (parsedRecords) {
        parsedRecords.forEach(p => parsedSet.add(p.student_link));
      }
      
      return students.map(s => {
        let validRecordPdf = '';
        if (s.record_link && (s.record_link.startsWith('http://') || s.record_link.startsWith('https://'))) {
          try {
            const urlObj = new URL(s.record_link);
            const pathParts = urlObj.pathname.split('/');
            const rawFileName = decodeURIComponent(pathParts[pathParts.length - 1]);
            const actualFileName = rawFileName.split('?')[0];
            
            if (existingFileSet.size > 0) {
              if (existingFileSet.has(actualFileName)) {
                validRecordPdf = s.record_link;
              } else {
                // Storage 폴더에서 파일이 삭제되었다면 DB 레코드 링크도 자동으로 초기화
                window.supabaseClient.from('students').update({ record_link: null }).eq('id', s.id).then();
              }
            } else {
              validRecordPdf = s.record_link;
            }
          } catch(err) {
            validRecordPdf = s.record_link;
          }
        }
        
        return {
          id: s.id,
          is_hidden: s.is_hidden || false,
          admissionYear: s.admission_year || '',
          center: s.center_name || '',
          name: s.student_name || '',
          school: s.school || '',
          targetSchool: s.target_school || '',
          parentPhone: s.parent_contact || '',
          studentPhone: s.student_contact || '',
          teacher: s.teacher || s.math_teacher || '',
          mathTeacher: s.teacher || s.math_teacher || '',
          sciTeacher: s.science_teacher || '',
          recordPdf: validRecordPdf,
          recordScore: s.record_score_ai || '',
          psSheet: '',
          studentLink: s.student_link || s.id || '',
          psStatus: s.cover_letter_status || '',
          psFeedback: s.cover_letter_feedback_ai || '',
          questions: (s.expected_questions_ai_ps || '') + '|' + (s.expected_questions_ai_record || '') || (s.expected_questions_ai || ''),
          studentAnswers: practiceMap[s.student_link || s.id] || '',
          isParsed: parsedSet.has(s.student_link || s.id),
          passRound1: s.result_1st || '대기',
          passRound2: s.result_2nd || '대기',
          passFinal: s.result_final || '대기',
          student_memo: s.student_memo || '',
          isReference: !!s.is_reference
        };
      });
    } catch (err) {
      console.error('getStudentsList error:', err);
      return [];
    }
}

// 학생 숨김 처리 상태 토글
async function toggleStudentHidden(studentLink, isHidden) {
  try {
    const { error } = await window.supabaseClient.from('students').update({ is_hidden: isHidden }).eq('student_link', studentLink);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('toggleStudentHidden error:', err);
    throw err;
  }
}

// 학생 상태 변경(합불)
async function updatePassStatus(payload) {
  try {
    let updates = {};
    if (payload.passType === 'passRound1') {
      updates['result_1st'] = payload.passValue;
      if (payload.passValue === '불') {
        updates['result_2nd'] = '불';
        updates['result_final'] = '불';
      } else if (payload.passValue === '합' || payload.passValue === '대기') {
        updates['result_2nd'] = '대기';
        updates['result_final'] = '대기';
      }
    } else if (payload.passType === 'passRound2') {
      updates['result_2nd'] = payload.passValue;
      if (payload.passValue === '불') {
        updates['result_final'] = '불';
      } else if (payload.passValue === '합' || payload.passValue === '대기') {
        updates['result_final'] = '대기';
      }
    } else if (payload.passType === 'passFinal') {
      updates['result_final'] = payload.passValue;
    } else {
      updates[payload.passType] = payload.passValue;
    }
    
    await window.supabaseClient.from('students').update(updates).eq('student_link', payload.studentId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


// --- 누락된 자소서 및 학생 관리 함수 복구 ---

async function getPersonalStatementHistory(payload) {
  try {
    const studentId = payload.studentId || payload;
    
    // 1. 학생 기본 정보 로드
    const { data: student } = await window.supabaseClient.from('students').select('*').eq('student_link', studentId).single();
    if (!student) throw new Error('학생 정보를 찾을 수 없습니다.');
    
    const targetSchool = (student.target_school || student.targetSchool || '').trim();

    const currentStateMap = {};
    
    // 2. 학교 문항 로드 (settings 조회)
    let qMap = {};
    let allSchoolsQMap = {}; // 전체 학교 문항 저장용
    
    const { data: settingsRow } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'schools').single();
    if (settingsRow && settingsRow.setting_value) {
      try {
        const schoolsData = JSON.parse(settingsRow.setting_value);
        
        // 전체 학교의 문항 데이터를 allSchoolsQMap에 저장
        schoolsData.forEach(school => {
          allSchoolsQMap[school.name] = {};
          if (school.questions) {
            school.questions.forEach(q => {
              allSchoolsQMap[school.name][String(q.label)] = q.content || '';
            });
          }
        });

        // 기존 현재 학교(targetSchool) qMap 및 currentStateMap 초기화 로직 유지
        if (targetSchool) {
          const matchedSchool = schoolsData.find(s => s.name === targetSchool);
          if (matchedSchool && matchedSchool.questions) {
            matchedSchool.questions.forEach(q => {
              const qVal = String(q.label);
              qMap[qVal] = q.content || '';
              const uniqueKey = targetSchool + '|' + qVal;
              if (!currentStateMap[uniqueKey]) {
                currentStateMap[uniqueKey] = {
                  qNum: qVal, question: q.content || '', answer: '', text: '', feedback: '', length: 0, version_label: targetSchool
                };
              }
            });
          }
        }
      } catch (e) {}
    }
    
    // 3. 자소서 내용 모두 로드 (시간순 정렬)
    const { data: statements } = await window.supabaseClient.from('personal_statements').select('*').eq('student_link', studentId).order('updated_at', { ascending: true });
    
    // 4. 히스토리 스냅샷 빌드 (Event Sourcing 방식)
    const historyLogs = [];
    let lastUpdatedAt = null;

    (statements || []).forEach(s => {
      const qNumStr = String(s.question_no);
      
      let qText = '';
      if (s.version_label && allSchoolsQMap[s.version_label]) {
        qText = allSchoolsQMap[s.version_label][qNumStr] || allSchoolsQMap[s.version_label]['문항' + qNumStr] || '';
      }
      if (!qText) {
        qText = qMap[qNumStr] || qMap['문항' + qNumStr] || '';
      }
      
      const cleanVersionLabel = (s.version_label || '').trim();
      const uniqueKey = cleanVersionLabel + '|' + s.question_no;

      if (!currentStateMap[uniqueKey]) {
        currentStateMap[uniqueKey] = {
          qNum: s.question_no, question: qText, answer: '', text: '', feedback: '', length: 0, version_label: cleanVersionLabel, id: s.id
        };
      }
      
      // 값이 null이 아닐 때만 덮어쓰기 (자소서/피드백 중 변경된 것만 들어오므로)
      if (s.content !== null && s.content !== undefined) {
        currentStateMap[uniqueKey].text = s.content;
        currentStateMap[uniqueKey].answer = s.content;
        currentStateMap[uniqueKey].length = s.content.length;
        currentStateMap[uniqueKey].version_label = s.version_label;
        currentStateMap[uniqueKey].id = s.id;
      }
      // 과거 기록 호환성 유지 (구버전 피드백)
      if (s.teacher_feedback !== null && s.teacher_feedback !== undefined) {
        currentStateMap[uniqueKey].feedback = s.teacher_feedback;
      }

      // 스냅샷 그룹화 (동일한 저장 시점)
      if (lastUpdatedAt !== s.updated_at) {
        // 이전 스냅샷의 현재 상태를 깊은 복사하여 저장
        historyLogs.push({
          timestamp: s.updated_at,
          type: '자소서', // 히스토리는 이제 무조건 자소서만 취급
          texts: JSON.parse(JSON.stringify(Object.values(currentStateMap)))
        });
        lastUpdatedAt = s.updated_at;
      } else {
        // 같은 시점 배치 업데이트의 경우, 배열 마지막 스냅샷의 texts를 갱신
        if (historyLogs.length > 0) {
          historyLogs[historyLogs.length - 1].texts = JSON.parse(JSON.stringify(Object.values(currentStateMap)));
        }
      }
    });

    // 별도의 teacher_feedbacks 테이블에서 피드백 최신본 덮어쓰기 (시간순 정렬 강제)
    const { data: teacherFeedbacks } = await window.supabaseClient.from('teacher_feedbacks').select('*').eq('student_link', studentId).order('updated_at', { ascending: true });
    
    // 명시적인 학교 꼬리표가 붙은 피드백을 추적하기 위한 방어벽
    const explicitFeedbackKeys = new Set();

    (teacherFeedbacks || []).forEach(f => {
      let qNumStr = String(f.question_no);
      
      const vLabel = (f.version_label || '').trim();
      let targetKey;
      
      if (vLabel) {
        // 새로 업데이트된 3단 고유키 방식 (정확히 해당 학교의 탭에 꽂음)
        targetKey = vLabel + '|' + qNumStr;
      } else {
        // 구형 데이터 호환성 유지
        targetKey = targetSchool + '|' + qNumStr;
      }

      // [핵심 차단 로직] 꼬리표가 없는 유령 데이터(!vLabel)가, 이미 방어벽이 쳐진 자리를 덮어쓰려 하면 즉시 튕겨냄
      if (!vLabel && explicitFeedbackKeys.has(targetKey)) {
        return; // 하극상 무시하고 다음으로 넘어감
      }

      if (currentStateMap[targetKey]) {
        currentStateMap[targetKey].feedback = f.feedback || '';
        // 명확한 꼬리표(vLabel)가 있는 정상 최신 데이터가 자리를 차지하면, 그 자리에 철창(방어벽)을 내려 잠금
        if (vLabel) explicitFeedbackKeys.add(targetKey);
      } else if (!vLabel) {
        // 타겟 학교 키가 없으면 동일한 qNum을 가진 아무거나 덮어쓰기 (호환성 유지)
        for (let key in currentStateMap) {
           // 덮어쓰기 호환성 로직에서도 철창이 쳐진 자리는 건드리지 못하게 방어
           if (currentStateMap[key].qNum === qNumStr && !explicitFeedbackKeys.has(key)) {
               currentStateMap[key].feedback = f.feedback || '';
           }
        }
      }
    });

    const currentArr = Object.values(currentStateMap);
    
    // 5. AI 피드백 히스토리 로드
    let aiHistory = [];
    const { data: aiFbRows } = await window.supabaseClient.from('ai_feedback_history').select('*').eq('student_link', studentId).order('created_at', { ascending: true });
    if (aiFbRows) {
      aiHistory = aiFbRows.map(r => ({
        timestamp: r.created_at,
        type: r.type,
        feedback: r.feedback
      }));
    }

    return {
      success: true,
      current: currentArr,
      data: currentArr,
      history: historyLogs.reverse(), // 최신이 위로 오게 역순 정렬
      aiHistory: aiHistory,
      studentInfo: {
        name: student.student_name,
        school: student.school,
        targetSchool: targetSchool,
        status: student.cover_letter_status
      }
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function savePersonalStatement(payload) {
  try {
    const { studentId, contents, writer, isAllEmpty } = payload;
    const now = new Date().toISOString();
    
    const { data: student } = await window.supabaseClient.from('students').select('cover_letter_status, target_school').eq('student_link', studentId).single();
    if (student) {
      if (isAllEmpty && student.cover_letter_status !== '작성전') {
        await window.supabaseClient.from('students').update({ cover_letter_status: '작성전' }).eq('student_link', studentId);
      } else if (!isAllEmpty && student.cover_letter_status === '작성전') {
        await window.supabaseClient.from('students').update({ cover_letter_status: '작성중' }).eq('student_link', studentId);
      }
    }

    // 변경된 항목을 자소서와 피드백으로 분리
    const newSnapshots = {};
    const feedbackUpdates = {};

    contents.forEach(c => {
      if (c.type === '자소서') {
        const tSchool = student ? (student.targetSchool || student.target_school || '') : '';
        const vLabel = c.version_label || tSchool;
        const uniqueKey = vLabel + '|' + c.qNum;
        
        if (!newSnapshots[uniqueKey]) {
          newSnapshots[uniqueKey] = {
            student_link: studentId,
            question_no: c.qNum,
            version_label: vLabel,
            updated_at: now
          };
        }
        newSnapshots[uniqueKey].content = c.text;
      } else if (c.type === '피드백') {
        const tSchool = student ? (student.targetSchool || student.target_school || '') : '';
        const vLabel = c.version_label || tSchool;
        const uniqueKey = vLabel + '|' + c.qNum;
        feedbackUpdates[uniqueKey] = {
          qNum: c.qNum,
          vLabel: vLabel,
          text: c.text
        };
      }
    });

    // 1. 자소서가 변경된 문항은 무조건 새로운 히스토리 행을 insert
    for (const key in newSnapshots) {
      const row = newSnapshots[key];
      const { error: insErr } = await window.supabaseClient.from('personal_statements').insert(row);
      if (insErr) throw insErr;
    }

    // 2. 피드백이 변경된 문항은 teacher_feedbacks 테이블에 upsert
    for (const key in feedbackUpdates) {
      const fbData = feedbackUpdates[key];
      const fbPayload = {
        student_link: studentId,
        question_no: fbData.qNum,
        version_label: fbData.vLabel,
        feedback: fbData.text,
        updated_at: now
      };
      const { error: updErr } = await window.supabaseClient.from('teacher_feedbacks').upsert(fbPayload, { onConflict: 'student_link,question_no,version_label' });
      if (updErr) throw updErr;
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

window.deletePersonalStatementSnapshot = async function(recordId) {
  try {
    const { data, error } = await window.supabaseClient
      .from('personal_statements')
      .delete()
      .eq('id', recordId)
      .select();
    
    if (error) throw error;
    if (!data || data.length === 0) {
      return { success: false, error: '삭제할 데이터를 찾지 못했습니다.' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function submitPersonalStatement(payload) {
  try {
    const studentId = payload.studentId || payload;
    await window.supabaseClient.from('students').update({ cover_letter_status: '최종제출' }).eq('student_link', studentId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function unlockPersonalStatement(payload) {
  try {
    const studentId = payload.studentId || payload;
    await window.supabaseClient.from('students').update({ cover_letter_status: '작성중' }).eq('student_link', studentId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function getScoreDetailsBasis(payload) {
  try {
    const studentId = payload.studentId || payload;
    const { data: record } = await window.supabaseClient.from('record_basis').select('*').eq('student_link', studentId).single();
    if (!record) return { success: true, json: null, report: '' };
    
    let scoreDetails = null;
    let scoreCards = [];
    try {
      scoreDetails = typeof record.score_details_json === 'string' ? JSON.parse(record.score_details_json) : record.score_details_json;
      const calcRes = calculateRecordScore(scoreDetails);
      scoreCards = generateScoreCardsData(scoreDetails, calcRes.scores, '관리자');
    } catch(e) {
      console.error('Error generating score cards:', e);
    }
    
    return {
      success: true,
      json: record.score_details_json,
      report: record.analysis_report,
      scoreCards: scoreCards,
      timestamp: record.created_at,
      totalScore: record.total_score
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function getAIQuestions(payload) {
  try {
    const studentId = payload.studentId || payload;
    const { data: practice } = await window.supabaseClient.from('interview_practice').select('*').eq('student_link', studentId).single();
    if (!practice) return { success: true, statement_questions_json: '', record_questions_json: '' };
    
    return { success: true, statement_questions_json: practice.statement_questions_json || '', record_questions_json: practice.record_questions_json || '' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function saveStudentAnswers(payload) {
  try {
    const { studentId, answersText } = payload;
    const { data: existing } = await window.supabaseClient.from('interview_practice')
      .select('id').eq('student_link', studentId).maybeSingle();
      
    if (existing && existing.id) {
      const { error } = await window.supabaseClient.from('interview_practice')
        .update({ answers_json: answersText }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await window.supabaseClient.from('interview_practice')
        .insert({ student_link: studentId, answers_json: answersText });
      if (error) throw error;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function registerStudent(payload) {
  try {
    const data = payload.studentData || payload;
    const insertObj = {
      admission_year: data.admissionYear || '',
      center_name: data.center || '',
      student_name: data.name || '',
      school: data.school || '',
      target_school: data.targetSchool || '',
      parent_contact: data.parentPhone || '',
      student_contact: data.studentPhone || '',
      teacher: data.teacher || data.mathTeacher || '',
      student_link: data.studentLink || Math.random().toString(36).substring(2, 14),
      cover_letter_status: '작성전',
      is_reference: !!data.isReference
    };
    const { error } = await window.supabaseClient.from('students').insert([insertObj]);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function updateStudent(payload) {
  try {
    const { studentData, originalLink } = payload;
    const updateObj = {
      admission_year: studentData.admissionYear || '',
      center_name: studentData.center || '',
      student_name: studentData.name || '',
      school: studentData.school || '',
      target_school: studentData.targetSchool || '',
      parent_contact: studentData.parentPhone || '',
      student_contact: studentData.studentPhone || '',
      teacher: studentData.teacher || studentData.mathTeacher || '',
      is_reference: !!studentData.isReference
    };
    const { error } = await window.supabaseClient.from('students').update(updateObj).eq('student_link', originalLink);
    if (error) throw error;

    // record_basis 테이블의 target_school 독립 업데이트
    if (updateObj.target_school) {
      await window.supabaseClient.from('record_basis')
        .update({ target_school: updateObj.target_school })
        .eq('student_link', originalLink);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function archiveStudent(payload) {
  try {
    const studentId = payload.studentId || payload;
    const { error } = await window.supabaseClient.from('students').delete().eq('student_link', studentId);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function hardDeleteStudent(payload) {
  try {
    const studentLink = payload.studentLink;
    
    // 1. Storage 버킷에서 해당 학생의 생기부 PDF 파일 삭제
    const fileName = `record_${studentLink}.pdf`;
    const { error: storageError } = await window.supabaseClient.storage.from('student_records').remove([fileName]);
    if (storageError) {
      console.warn('Storage file deletion error:', storageError);
    }
    
    // 2. DB에서 학생 레코드 삭제 (ON DELETE CASCADE로 연결된 데이터 함께 삭제됨)
    const { error } = await window.supabaseClient.from('students').delete().eq('student_link', studentLink);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function saveSettings(payload) {
  try {
    const { settingsData } = payload;
    if (settingsData.basic) {
      for (const key of Object.keys(settingsData.basic)) {
        await window.supabaseClient.from('settings').upsert({
          setting_key: key,
          setting_value: String(settingsData.basic[key] || '')
        }, { onConflict: 'setting_key' });
      }
    }
    if (settingsData.schools && Array.isArray(settingsData.schools)) {
    await window.supabaseClient.from('settings').upsert({
      setting_key: 'schools',
      setting_value: JSON.stringify(settingsData.schools)
    }, { onConflict: 'setting_key' });
    await window.supabaseClient.from('settings').upsert({
      setting_key: 'TargetSchools',
      setting_value: JSON.stringify(settingsData.schools)
    }, { onConflict: 'setting_key' });
  }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function getFilesInFolder(payload) {
  const korToEng = {
    '세종국제고': 'sejong_intl',
    '대전외고': 'daejeon_fl',
    '충남외고': 'chungnam_fl',
    '경기외고': 'gyeonggi_fl',
    '경기북과학고': 'gyeonggibuk',
    '부천과학고': 'bucheon',
    '분당중앙과학고': 'bundang',
    '인천진산과학고': 'incheon_jinsan',
    '인천과학고': 'incheon',
    '입학전형': 'admission',
    '입학요강': 'admission',
    '자소서': 'jaseoseo',
    '기출문항': 'exam',
    '기출문제': 'exam'
  };
  const engToKor = {
    'sejong_intl': '세종국제고',
    'daejeon_fl': '대전외고',
    'chungnam_fl': '충남외고',
    'gyeonggi_fl': '경기외고',
    'gyeonggibuk': '경기북과학고',
    'bucheon': '부천과학고',
    'bundang': '분당중앙과학고',
    'incheon_jinsan': '인천진산과학고',
    'incheon': '인천과학고',
    'admission': '입학전형',
    'jaseoseo': '자소서',
    'exam': '기출문항'
  };

  try {
    const folderId = payload.folderId || payload;
    const bucketName = 'school_materials';
    
    const { data: files, error } = await window.supabaseClient.storage.from(bucketName).list();
    if (error) throw error;
    
    const resultList = files.filter(f => f.name.endsWith('.pdf')).map(f => {
      let decodedName = null;
      if (f.name.startsWith('ENC_')) {
        try {
          let b64 = f.name.replace(/^ENC_/, '').replace(/\.pdf$/, '');
          b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
          while (b64.length % 4) { b64 += '='; }
          decodedName = decodeURIComponent(escape(atob(b64)));
        } catch(e) {
          decodedName = decodeURIComponent(f.name);
        }
      } else {
        // 영문 변환된 예쁜 이름을 다시 한글로 복구
        let name = f.name.replace('.pdf', '');
        for (let key in engToKor) {
          name = name.replace(new RegExp(key, 'g'), engToKor[key]);
        }
        decodedName = name.replace(/_/g, ' ') + '.pdf';
      }
      return { f, decodedName };
    }).filter(({ f, decodedName }) => {
      if (folderId === 'admissions') return decodedName.includes('입학전형') || decodedName.includes('입학요강') || decodedName.includes('자소서');
      if (folderId === 'exams') return decodedName.includes('기출문항') || decodedName.includes('기출문제');
      return true;
    }).map(({ f, decodedName }) => {
      const { data: pub } = window.supabaseClient.storage.from(bucketName).getPublicUrl(f.name);
      return { name: decodedName, url: pub.publicUrl, rawName: f.name };
    });
    
    // 연도 최신순, 그 다음 학교명 가나다순 정렬
    resultList.sort((a, b) => b.name.localeCompare(a.name));
    
    return { success: true, files: resultList };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function uploadGeneralPdf(payload) {
  try {
    const { folderId, base64Data, fileName } = payload;
    let bucketName = 'school_materials';
    
    const arr = base64Data.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){ u8arr[n] = bstr.charCodeAt(n); }
    const blob = new Blob([u8arr], {type: mime});
    
    const korToEng = {
      '세종국제고': 'sejong_intl',
      '대전외고': 'daejeon_fl',
      '충남외고': 'chungnam_fl',
      '경기외고': 'gyeonggi_fl',
      '경기북과학고': 'gyeonggibuk',
      '부천과학고': 'bucheon',
      '분당중앙과학고': 'bundang',
      '인천진산과학고': 'incheon_jinsan',
      '인천과학고': 'incheon',
      '입학전형': 'admission',
      '입학요강': 'admission',
      '자소서': 'jaseoseo',
      '기출문항': 'exam',
      '기출문제': 'exam'
    };
    
    let safeKey = fileName.replace('.pdf', '');
    for (let key in korToEng) {
      safeKey = safeKey.replace(new RegExp(key, 'g'), korToEng[key]);
    }
    safeKey = safeKey.replace(/\s+/g, '_');
    
    // 영문 치환 후에도 한글이 남아있다면 기존 ENC_ 암호화 방식으로 폴백
    if (/[가-힣]/.test(safeKey)) {
      const b64 = btoa(unescape(encodeURIComponent(fileName)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      safeKey = 'ENC_' + b64 + '_' + Date.now() + '.pdf';
    } else {
      safeKey = safeKey + '_' + Date.now() + '.pdf';
    }
    
    const { data, error } = await window.supabaseClient.storage.from(bucketName).upload(safeKey, blob, {
      contentType: 'application/pdf',
      upsert: false
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function resetAIQuestions(payload) {
  try {
    const { studentId, type } = payload;
    const { data: existingPract } = await window.supabaseClient.from('interview_practice').select('*').eq('student_link', studentId).maybeSingle();
    
    if (existingPract && existingPract.id) {
      let updateObj = {};
      if (type === '자소서') {
        updateObj.statement_questions_json = '';
        updateObj.base_version_ps = '';
      } else {
        updateObj.record_questions_json = '';
        updateObj.base_version_record = '';
      }
      
      // 프론트엔드에서 특정 모드의 답변만 제거하여 보낸 새 answers_json 반영
      if (payload.updatedAnswersText !== undefined) {
        updateObj.answers_json = payload.updatedAnswersText;
      }

      const res = await window.supabaseClient.from('interview_practice').update(updateObj).eq('id', existingPract.id);
      if (res.error) throw new Error('초기화 DB 갱신 실패: ' + res.error.message);
    }
    
    // students 상태 컬럼도 초기화
    let studentUpdateObj = {};
    if (type === '자소서') {
      studentUpdateObj.expected_questions_ai_ps = '';
    } else {
      studentUpdateObj.expected_questions_ai_record = '';
    }
    await window.supabaseClient.from('students').update(studentUpdateObj).eq('student_link', studentId);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// --- 전역(window) 객체 명시적 바인딩 ---

window.verifyPassword = verifyPassword;
window.getSettings = getSettings;
window.getStudentsList = getStudentsList;
window.toggleStudentHidden = toggleStudentHidden;
window.updatePassStatus = updatePassStatus;
window.getPersonalStatementHistory = getPersonalStatementHistory;
window.savePersonalStatement = savePersonalStatement;
window.submitPersonalStatement = submitPersonalStatement;
window.unlockPersonalStatement = unlockPersonalStatement;
window.getScoreDetailsBasis = getScoreDetailsBasis;
window.getAIQuestions = getAIQuestions;
window.resetAIQuestions = resetAIQuestions;
window.saveStudentAnswers = saveStudentAnswers;
window.registerStudent = registerStudent;
window.updateStudent = updateStudent;
window.archiveStudent = archiveStudent;
window.hardDeleteStudent = hardDeleteStudent;
window.saveSettings = saveSettings;
// AI functions export
window.generateAIFeedback = generateAIFeedback;
window.generateAIQuestions = generateAIQuestions;
window.evaluateStudentRecord = evaluateStudentRecord;
window.parseStudentRecord = parseStudentRecord;
window.uploadStudentRecordPdf = uploadStudentRecordPdf;
window.extractTextFromPdf = extractTextFromPdf;

window.getFilesInFolder = getFilesInFolder;
window.uploadGeneralPdf = uploadGeneralPdf;
window.deleteGeneralPdf = deleteGeneralPdf;
window.saveStudentMemo = saveStudentMemo;
window.getAIChecklist = getAIChecklist;
window.generateAIChecklist = generateAIChecklist;

async function deleteGeneralPdf(payload) {
  try {
    const fileName = payload.fileName || payload;
    const { data, error } = await window.supabaseClient.storage.from('school_materials').remove([fileName]);
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("수파베이스 Storage 삭제 권한이 없거나 파일이 존재하지 않습니다. (Storage 정책에서 DELETE 권한이 켜져 있는지 확인하세요.)");
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// --- 자소서 전체 진행률 일괄 집계 (N+1 쿼리 방지) ---
async function getAllPsProgress() {
  try {
    let allStatements = [];
    let from = 0;
    const pageSize = 1000;
    
    // 수파베이스 기본 1000건 제한(Pagination) 돌파 로직
    while (true) {
      const { data: statements, error } = await window.supabaseClient
        .from('personal_statements')
        .select('student_link, question_no, content, updated_at, version_label') // version_label 추가
        .order('updated_at', { ascending: true })
        .range(from, from + pageSize - 1);
        
      if (error || !statements || statements.length === 0) break;
      allStatements = allStatements.concat(statements);
      if (statements.length < pageSize) break;
      from += pageSize;
    }

    const progressMap = {};
    allStatements.forEach(row => {
      if (!progressMap[row.student_link]) progressMap[row.student_link] = {};
      
      const vLabel = (row.version_label || '').trim();
      if (!progressMap[row.student_link][vLabel]) progressMap[row.student_link][vLabel] = {};
      
      // Null 방어: 실제 텍스트가 있을 때만 덮어쓰기
      if (row.content !== null && row.content !== undefined) {
        // 타입 충돌 방지를 위해 강제 String 캐스팅 후 태그 제거
        const cleanText = String(row.content).replace(/\[상세분할\]/g, '');
        const noSpaceText = cleanText.replace(/\s+/g, '');
        
        // 3단 구조로 덮어쓰기 (student_link -> version_label -> question_no)
        progressMap[row.student_link][vLabel][row.question_no] = {
          withSpace: cleanText.length,
          noSpace: noSpaceText.length
        };
      }
    });
    return progressMap;
  } catch (err) {
    console.error('getAllPsProgress error:', err);
    return {}; // 에러 시 안전하게 빈 객체 반환
  }
}
window.getAllPsProgress = getAllPsProgress;
