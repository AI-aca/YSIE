
function extractDriveId(val) {
  if (!val) return '';
  let match = val.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  match = val.match(/id=([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  match = val.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return val.trim();
}
/**
 * ==================================================================================
 * ⚙️ [2027 외고·국제고 관리 사이트] 프론트엔드 연동 스크립트 (script.js)
 * ==================================================================================
 */

// 🌐 구글 웹 앱 배포 완료 후 생성된 URL을 아래 변수에 입력하십시오.
// (로컬 브라우저에서 실행하더라도 이 주소를 통해 스프레드시트와 실시간 연동됩니다.)
const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyEWonmK_Gj0coEkr9CSwXfcXg9OdFoaikphI8mAq9rZmmJD0gCy90WCyuvu97nZhx3Xg/exec';


// 🔐 권한 상태
let isPsDirty = false;
let CURRENT_ROLE = null; // '교사' | '관리자' | '학생'
let CURRENT_STUDENT_ID = null; // 학생 접속인 경우의 학생 번호/토큰
let ACTIVE_ADMIN_PASSWORD = ''; // 관리자 락 해제 요청 시 검증용 캐시 패스워드
let SETTINGS_CENTERS = []; // 센터명 캐시
let isEditMode = false; // 신규 학생 등록 및 수정 모달 상태 플래그
let ACTIVE_EDIT_STUDENT_LINK = ''; // 수정 모드 시 학생 고유링크 저장용
window.updateCenterDropdowns = function() {
  const regCenter = document.getElementById('reg-center');
  if (regCenter) {
    regCenter.innerHTML = '<option value="">센터 선택</option>';
    SETTINGS_CENTERS.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      regCenter.appendChild(opt);
    });
  }
};

window.populateAdmissionYearDropdowns = function() {
  const currentYear = new Date().getFullYear();
  const defaultYear = currentYear + 1;
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  
  const regYear = document.getElementById('reg-admission-year');
  if (regYear) {
    regYear.innerHTML = '';
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y.toString();
      opt.textContent = y.toString() + '학년도';
      if (y === defaultYear) opt.selected = true;
      regYear.appendChild(opt);
    });
  }

  const filterYear = document.getElementById('filter-admission-year');
  if (filterYear) {
    filterYear.innerHTML = '<option value="전체">학년도 전체</option>';
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y.toString();
      opt.textContent = y.toString() + '학년도';
      filterYear.appendChild(opt);
    });
  }
};

const GlobalLoader = {
  interval: null,
  percent: 0,
  show(speedMs = 300) {
    const overlay = document.getElementById('global-loader-overlay');
    const textEl = document.getElementById('loader-percentage-text');
    if (!overlay || !textEl) return;
    overlay.classList.remove('hidden');
    this.percent = 0;
    textEl.innerText = '0%';
    clearInterval(this.interval);
    this.interval = setInterval(() => {
      if (this.percent < 99) {
        this.percent += Math.floor(Math.random() * 5) + 1;
        if (this.percent > 99) this.percent = 99;
        textEl.innerText = this.percent + '%';
      }
    }, speedMs);
  },
  hide() {
    const overlay = document.getElementById('global-loader-overlay');
    const textEl = document.getElementById('loader-percentage-text');
    if (!overlay || !textEl) return;
    clearInterval(this.interval);
    this.percent = 100;
    textEl.innerText = '100%';
    setTimeout(async () => {
      overlay.classList.add('hidden');
    }, 300);
  }
};

// 🌐 전역 합불 통신 함수 신설
window.updatePassStatusFrontend = async function(studentLink, passType, passValue) {
  try {
    const result = await ApiClient.post('updatePassStatus', { studentId: studentLink, passType, passValue }, { hideLoader: true });
    if (!result.success) {
      alert('합불 상태 저장 실패: ' + result.error);
    } else {
      const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentLink));
      if (student) {
        student[passType] = passValue;
        if (passType === 'passRound1') {
          if (passValue === '불') {
            student.passRound2 = '불';
            student.passFinal = '불';
          } else if (passValue === '합' || passValue === '대기') {
            student.passRound2 = '대기';
            student.passFinal = '대기';
          }
        } else if (passType === 'passRound2') {
          if (passValue === '불') {
            student.passFinal = '불';
          } else if (passValue === '합' || passValue === '대기') {
            student.passFinal = '대기';
          }
        }
        if (typeof renderMainTable === 'function') {
          renderMainTable();
        }
      }
    }
  } catch (e) {
    alert('합불 통신 오류: ' + e.toString());
  }
};

// 🌐 통합 API Client 클래스 (로컬/배포 무결성 보장)
const ApiClient = {
  async post(action, payload = {}, options = {}) {
    const useLoader = !options.hideLoader;
    if (useLoader) {
      let speedMs = 300;
      if (action === 'generateAIFeedback') {
        speedMs = 900;
      } else if (action === 'generateAIQuestions') {
        speedMs = 3000;
      } else if (action === 'evaluateStudentRecord' || action === 'extractTextFromPdf' || action === 'uploadStudentRecordPdf') {
        speedMs = 4500;
      }
      GlobalLoader.show(speedMs);
    }
    try {
      if (typeof window[action] !== 'function') {
        throw new Error(`백엔드 로직 ${action} 가 로드되지 않았습니다. backend_logic.js가 연결되었는지 확인하세요.`);
      }
      
      let result;
      // action에 따라 backend_logic.js의 각 함수 서명에 맞게 인자를 풀어서 전달
      switch(action) {
        case 'generateAIFeedback':
          result = await window[action](payload.studentId || payload.studentLink, payload.qNum, payload.statementText);
          break;
        case 'resetAIFeedback':
          result = await window[action](payload.studentId, payload.typeStr);
          break;
        case 'generateAIQuestions':
          result = await window[action](payload.studentId || payload.studentLink, payload.type);
          break;
        case 'evaluateStudentRecord':
          result = await window[action](payload.studentId || payload.studentLink, payload.recordText);
          break;
        case 'extractTextFromPdf':
          result = await window[action](payload.fileUrl);
          break;
        case 'uploadStudentRecordPdf':
          result = await window[action](payload.studentId || payload.studentLink, payload.fileObject, payload.fileName);
          break;
        case 'toggleStudentHidden':
          result = await window[action](payload.studentLink, payload.isHidden);
          break;
        default:
          result = await window[action](payload);
      }
      
      return result;
      
    } catch (error) {
      console.error(`[API Error: ${action}]`, error);
      return { success: false, error: error.message || String(error) };
    } finally {
      if (useLoader) GlobalLoader.hide();
    }
  }
};

function showGlobalLoader(text, speedMs = 300) {
  GlobalLoader.show(speedMs);
  const t = document.getElementById('loader-percentage-text');
  if (t) t.innerText = text || '서버와 통신 중입니다...';
}
function hideGlobalLoader() {
  GlobalLoader.hide();
}

// 타임스탬프 포맷팅 헬퍼 함수

function parseMarkdownToHtml(text) {
  if (!text) return '';
  
  // 112차에 DB에 삽입된 span 태그 찌꺼기 청소 (롤백)
  let cleanedText = text.replace(/<span[^>]*>💡 \[종합 총평\]<\/span>/g, '[종합 총평]');
  
  let html = cleanedText
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^---$/gim, '<hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;">')
    .replace(/^### (.*$)/gim, '<h4 style="color: var(--color-primary); margin: 0 0 8px 0; font-size: 16px;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="color: var(--color-primary); margin: 24px 0 10px 0; font-size: 18px; padding-top: 12px;">$1</h3>')
    .replace(/^# (.*$)/gim, '<h2 style="color: #fff; margin: 0 0 12px 0; font-size: 22px;">$1</h2>')
    .replace(/🗣️ 면접 질문:/gim, '<span style="color: var(--color-primary); font-weight: bold;">🗣️ 면접 질문:</span>')
    .replace(/🎯 출제 의도:/gim, '<span style="color: var(--color-primary); font-weight: bold;">🎯 출제 의도:</span>')
    .replace(/🔗 꼬리 질문:/gim, '<span style="color: var(--color-primary); font-weight: bold;">🔗 꼬리 질문:</span>')
    .replace(/^&gt;\s?🚨\s?\*\*(.*?)\*\*(.*$)/gim, '<div style="background-color: rgba(255, 0, 0, 0.1); border: 1px solid #ff4444; color: #ff6666; font-weight: bold; padding: 12px; border-radius: 6px; margin: 12px 0;">🚨 $1$2</div>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong style="color: #fff;">$1</strong>')
    .replace(/^\* (.*$)/gim, '<li style="margin-left: 20px; margin-bottom: 4px;">$1</li>')
    .replace(/^- (.*$)/gim, '<li style="margin-left: 20px; list-style-type: circle; margin-bottom: 4px;">$1</li>')
    .replace(/^&gt;\s?(.*$)/gim, '<div style="border-left: 3px solid var(--color-primary); background: rgba(0,0,0,0.2); margin: 8px 0; padding: 12px; color: var(--text-muted); line-height: 1.5;">$1</div>')
    .replace(/\s*\[종합 총평\]\s*/g, '<br><br>');
    
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/(<br>)+(<hr[^>]*>)/gi, '$2'); // 가로줄 앞의 잉여 빈줄(br) 싹둑 자르기
  html = html.replace(/(<\/h2>|<\/h3>|<\/h4>|<hr[^>]*>|<\/div>|<\/li>)<br>*/g, '$1');
  html = html.replace(/^(<br>)+/, ''); // 맨 앞 공백 치우기
  return html;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  // 구글 시트에서 ISO 8601 문자열(예: 2026-07-16T22:21:00.000Z)로 반환될 경우의 처리
  const d = new Date(ts);
  if (!isNaN(d.getTime())) {
    const yy = String(d.getFullYear()).slice(-2);
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${yy}-${MM}-${dd} ${hh}:${mm}`;
  }
  return ts;
}

// 간단한 마크다운 파싱 헬퍼 함수
function parseMarkdown(text) {
  if (!text) return '';
  let html = text.replace(/^\s+/, '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // XSS 방지
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--color-primary-light); font-weight:700;">$1</strong>'); // Bold
  html = html.replace(/^#### (.*)$/gim, '<h4 style="margin-top:20px; margin-bottom:8px; color:var(--color-primary); font-size:15px;">$1</h4>'); // H4
  html = html.replace(/^### (.*)$/gim, '<h3 style="margin-top:0; margin-bottom:12px; color:var(--color-primary); font-size:17px; padding-top:0;">$1</h3>'); // H3 (항목 선 완전히 제거)
  html = html.replace(/^## (.*)$/gim, '<h3 style="margin-top:24px; margin-bottom:12px; color:var(--color-primary); font-size:17px; padding-top:12px;">$1</h3>'); // H2 (예외처리)
  html = html.replace(/^# (.*)$/gim, '<h3 style="margin-top:24px; margin-bottom:12px; color:var(--color-primary); font-size:17px; padding-top:12px;">$1</h3>'); // H1 (예외처리)
  html = html.replace(/^[#\s]*===\s*(문항\s*\d+).*?===$/gim, '<h3 style="margin-top:36px; margin-bottom:12px; color:var(--color-primary); font-size:17px; border-top:1px solid rgba(255,255,255,0.2); padding-top:16px;">[$1]</h3>'); // === 문항 N === (AI 변칙 문자 포용)
  html = html.replace(/^\s*---\s*$/gim, ''); // 구분선(---) 제거
  html = html.replace(/^[\*\-]\s+(.*)$/gim, '<div style="padding-left:16px; position:relative; margin-bottom:12px;"><span style="position:absolute; left:0; color:var(--color-primary);">•</span>$1</div>'); // List
  html = html.replace(/^> (.*)$/gim, '<div style="border-left: 3px solid var(--color-primary); margin: 12px 0; color: #bbb; background: rgba(0,0,0,0.15); padding: 10px 12px; border-radius: 4px;">$1</div>'); // Quote
  
  // 제목(h3, h4) 주변의 중복된 엔터(줄바꿈) 제거 (마진과 중첩되어 간격이 넓어지는 현상 방지)
  html = html.replace(/\n+(<h[34])/g, '$1');
  html = html.replace(/(<\/h[34]>)\n+/g, '$1');
  
  return html;
}

// 🚀 어플리케이션 상태 라이프사이클 초기화
document.addEventListener('DOMContentLoaded', async () => {
  // 세션 스토리지 역할 복원 (리팩토링 6)
  const savedRole = sessionStorage.getItem('user_role');
  const savedPw = sessionStorage.getItem('user_pw');
  if (savedRole) {
    CURRENT_ROLE = savedRole;
    if (savedRole === '관리자') {
      ACTIVE_ADMIN_PASSWORD = savedPw || '';
    }
    applyRoleUI(CURRENT_ROLE);
  }

  detectRoleFromUrl();
  
  populateAdmissionYearDropdowns();
  await loadSettingsForm();
  loadStudentsData();
  
  bindEventHandlers();
  
  if (CURRENT_ROLE === '학생') {
    // 이벤트 리스너 부착 완료 후 안전하게 자기소개서 메뉴 강제 클릭
    const psMenuBtn = document.querySelector('.menu-item[data-menu="ps"]');
    if (psMenuBtn) psMenuBtn.click();
  }
  
  // 들어가자마자 인증된 권한이 없다면 비번 입력 팝업 즉시 기동 및 화면 차단
  if (!CURRENT_ROLE) {
    applyRoleUI(CURRENT_ROLE);
    document.getElementById('modal-login').classList.add('open');
  }
});

/**
 * 권한 역할별 UI 동적 활성화 제어
 */
function applyRoleUI(role) {
  // 인증 완료 후 메인 레이아웃 표시 (FOUC 방지)
  const appLayout = document.getElementById('app-layout');
  if (appLayout) appLayout.style.visibility = 'visible';

  const regBtn = document.getElementById('sidebar-register-area');
  const settingsMenu = document.getElementById('menu-settings');
  const aiFeedbackTab = document.getElementById('tab-btn-ai-feedback');
  const headerActions = document.getElementById('main-header-actions');
  
  if (headerActions) {
    headerActions.innerHTML = '';
  }

  // AI 챗봇 토글 버튼 노출 제어
  const chatbotToggle = document.getElementById('btn-ai-chatbot-toggle');
  if (chatbotToggle) chatbotToggle.style.display = 'flex';
  
  const sBanner = document.getElementById('student-warning-banner');
  if (sBanner) sBanner.style.display = 'none';
  const mainContent = document.querySelector('main.dashboard-content');
  const sidebar = document.querySelector('nav.sidebar');

  if (!role) {
    if (mainContent) mainContent.style.display = 'none';
    if (sidebar) sidebar.style.display = 'none';
    if (chatbotToggle) chatbotToggle.style.display = 'none';
    return;
  } else {
    if (mainContent) mainContent.style.display = 'block';
    if (sidebar) sidebar.style.display = 'flex';
    if (chatbotToggle) chatbotToggle.style.display = 'flex';
  }
  
  if (role === '학생') {
    if (regBtn) regBtn.style.display = 'none';
    const menusToHideForStudent = ['menu-dashboard', 'menu-info', 'menu-record', 'menu-settings'];
    menusToHideForStudent.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.parentNode.style.display = 'none';
    });
    const btnUploadPdf = document.getElementById('btn-upload-pdf');
    if (btnUploadPdf) btnUploadPdf.style.display = 'none'; // 학생은 숨김
    if (document.getElementById('wrapper-hide-hidden')) document.getElementById('wrapper-hide-hidden').style.display = 'none';

    
    if (aiFeedbackTab) aiFeedbackTab.style.display = 'none';
    document.getElementById('current-role-display').textContent = '학생 전용 작성';
    document.getElementById('current-user-status').textContent = '자기소개서 작성 권한';
    document.getElementById('btn-login-modal').style.display = 'none';
    if (sBanner) {
      if (CURRENT_MENU === 'ps') {
        sBanner.style.display = 'block';
      } else {
        sBanner.style.display = 'none';
      }
    }
  } else if (role === '교사') {
    if (regBtn) regBtn.style.display = 'block';
    if (settingsMenu) settingsMenu.parentNode.style.display = 'none';
    const btnUploadPdf = document.getElementById('btn-upload-pdf');
    if (btnUploadPdf) btnUploadPdf.style.display = 'none'; // 교사는 숨김 (조회만 가능)
    if (document.getElementById('wrapper-hide-hidden')) document.getElementById('wrapper-hide-hidden').style.display = 'none';

    if (aiFeedbackTab) aiFeedbackTab.style.display = 'block';
    document.getElementById('current-role-display').textContent = '일반 교사 계정';
    document.getElementById('current-user-status').textContent = '조회 및 첨삭 권한 보유';
    
    const loginBtn = document.getElementById('btn-login-modal');
    loginBtn.style.display = 'block';
    loginBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i> [로그아웃]';
    loginBtn.onclick = () => {
      sessionStorage.removeItem('user_role');
      sessionStorage.removeItem('user_pw');
      alert('로그아웃 되었습니다.');
      window.location.reload();
    };
  } else if (role === '관리자') {
    if (regBtn) regBtn.style.display = 'block';
    if (settingsMenu) settingsMenu.parentNode.style.display = 'block';
    const btnUploadPdf = document.getElementById('btn-upload-pdf');
    if (btnUploadPdf) btnUploadPdf.style.display = 'block'; // 관리자 보임
    if (document.getElementById('wrapper-hide-hidden')) document.getElementById('wrapper-hide-hidden').style.display = 'flex';

    if (aiFeedbackTab) aiFeedbackTab.style.display = 'block';
    document.getElementById('current-role-display').textContent = '시스템 관리자';
    document.getElementById('current-user-status').textContent = 'AI 및 모든 환경 제어권 보유';
    
    const loginBtn = document.getElementById('btn-login-modal');
    loginBtn.style.display = 'block';
    loginBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i> [로그아웃]';
    loginBtn.onclick = () => {
      sessionStorage.removeItem('user_role');
      sessionStorage.removeItem('user_pw');
      alert('로그아웃 되었습니다.');
      window.location.reload();
    };
    
    if (headerActions) {
      headerActions.innerHTML = '';
    }
  }
}

let PDF_TARGET_STUDENT = null;
window.triggerPdfUpload = function(studentLink, isReupload) {
  if (isReupload && !confirm('기존 생기부 파일이 이미 존재합니다. 재업로드하시면 기존 생기부가 덮어씌워집니다. 계속하시겠습니까?')) return;
  PDF_TARGET_STUDENT = studentLink;
  const fileInput = document.getElementById('student-record-pdf-input');
  if (fileInput) {
    fileInput.value = ''; // 초기화
    fileInput.click();
  }
};

/**
 * URL 파라미터를 읽어 학생 권한 여부 확인 (보안 강화)
 */
function detectRoleFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const studentToken = urlParams.get('student') || urlParams.get('id');
  
  if (studentToken) {
    CURRENT_ROLE = '학생';
    CURRENT_STUDENT_ID = studentToken;
    
    // 학생 권한 UI 적용
    applyRoleUI('학생');
  }
}

/**
 * 전체 학생 데이터 연동 로드
 */

/**
 * 정확한 학년도와 학교명을 매칭하여 문항 정보를 반환합니다.
 */
window.findSchoolConfig = function(name, year) {
  if (!window.SCHOOL_QUESTIONS_MAP) return null;
  const safeName = String(name || '').trim();
  const safeYear = String(year || '').trim();
  
  let matched = window.SCHOOL_QUESTIONS_MAP.find(s => String(s.name).trim() === safeName && String(s.admissionYear || '').trim() === safeYear);
  if (matched) return matched;
  
  matched = window.SCHOOL_QUESTIONS_MAP.find(s => String(s.name).trim() === safeName && !String(s.admissionYear || '').trim());
  if (matched) return matched;
  
  return window.SCHOOL_QUESTIONS_MAP.find(s => String(s.name).trim() === safeName);
};

let STUDENTS_LIST = [];
let PS_PROGRESS_MAP = {}; // 전역 스토어 추가
let isStudentsDataLoading = true; // 최초 로딩 상태 플래그 추가

async function loadStudentsData() {
  isStudentsDataLoading = true;
  renderMainTable(); // 로딩 중 UI를 띄우기 위해 선호출
  try {
    // 50명 목록과 글자수 현황 Map을 단 한 번에 병렬 로드
    const [studentsRes, progressRes] = await Promise.all([
      ApiClient.post('getStudentsList'),
      window.getAllPsProgress()
    ]);
    
    if (CURRENT_ROLE === '학생' && CURRENT_STUDENT_ID) {
      const me = studentsRes.find(s => String(s.studentPhone) === String(CURRENT_STUDENT_ID) || String(s.studentLink) === String(CURRENT_STUDENT_ID));
      if (me && me.is_hidden) {
        document.body.innerHTML = '<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-size:24px; color:#ef4444; font-weight:bold;">관리자에 의해 시스템 접근이 물리적으로 차단된 상태입니다.</div>';
        throw new Error('Blocked access by admin.');
      }
    }
    
    if (CURRENT_ROLE !== '관리자') {
      STUDENTS_LIST = studentsRes.filter(s => !s.is_hidden);
    } else {
      STUDENTS_LIST = studentsRes;
    }
    
    PS_PROGRESS_MAP = progressRes;
  } catch (err) {
    console.error('학생 데이터 로드 실패:', err);
    STUDENTS_LIST = [];
    PS_PROGRESS_MAP = {};
  } finally {
    isStudentsDataLoading = false;
    renderMainTable(); // 데이터 도착 후 실제 렌더링
  }
}

// 🗂️ 사이드바 메뉴별 동적 컬럼 정보 매핑
const TABLE_COLUMNS = {
  dashboard: [
    { label: '학년도', key: 'admissionYear' },
    { label: '센터명', key: 'center' },
    { label: '학생명', key: 'name' },
    { label: '현재 학교', key: 'school' },
    { label: '지원학교', key: 'targetSchool' },
    { label: '서류 합불(1단계)', key: 'passRound1' },
    { label: '최종 합불(2단계)', key: 'passFinal' },
    { label: '링크(배포)', key: 'studentLink' },
    { label: '문자(배포)', key: 'studentSms' },
    { label: '관리', key: 'manage' }
  ],
  info: [
    { label: '학년도', key: 'admissionYear' },
    { label: '센터명', key: 'center' },
    { label: '학생명', key: 'name' },
    { label: '현재 학교', key: 'school' },
    { label: '지원학교', key: 'targetSchool' },
    { label: '담당자', key: 'teacher' },
    { label: '학부모 연락처', key: 'parentPhone' },
    { label: '학생 연락처', key: 'studentPhone' }
  ],
  record: [
    { label: '학년도', key: 'admissionYear' },
    { label: '센터명', key: 'center' },
    { label: '학생명', key: 'name' },
    { label: '현재 학교', key: 'school' },
    { label: '지원학교', key: 'targetSchool' },
    { label: '생기부 보기', key: 'recordView' },
    { label: '생기부 업로드', key: 'recordUpload' },
    { label: '생기부 점수', key: 'recordScoreOnly' },
    { label: '생기부 점수근거', key: 'recordBasis' },
    { label: 'AI 채점', key: 'recordEval' }
  ],
  ps: [
    { label: '학년도', key: 'admissionYear' },
    { label: '센터명', key: 'center' },
    { label: '학생명', key: 'name' },
    { label: '현재 학교', key: 'school' },
    { label: '지원학교', key: 'targetSchool' },
    { label: '최종여부', key: 'psStatus' },
    { label: '글자수 현황', key: 'psProgress' },
    { label: '자소서 뷰어', key: 'psViewer' },
    { label: '관리', key: 'manage' }
  ],
  interview: [
    { label: '학년도', key: 'admissionYear' },
    { label: '센터명', key: 'center' },
    { label: '학생명', key: 'name' },
    { label: '현재 학교', key: 'school' },
    { label: '지원학교', key: 'targetSchool' },
    { label: '담당자', key: 'teacher' },
    { label: '공통과제 연습', key: 'interviewAssign' },
    { label: '생기부 기반 연습', key: 'interviewRecord' },
    { label: '자소서 기반 연습', key: 'interviewPs' }
  ]
};

let CURRENT_MENU = 'dashboard';
let currentSortCol = 'name';
let currentSortDir = 'asc'; // 'asc' or 'desc'

/**
 * 동적 컬럼 렌더링 테이블 구현 (가로 스크롤 차단)
 */
function copySmsTemplate(center, name, link) {
  const url = window.location.origin + window.location.pathname + '?student=' + link;
  const text = `[와이즈만 ${center}]

외고·국제고 합격을 위한 개별 관리 링크를 보내드립니다.
이 링크를 통해 자소서 작성 및 예상질문 답변을 작성해 주세요.
* 모바일이 아닌 PC나 노트북 환경의 크롬 브라우저를 권장 드립니다.

${name} 학생의 링크

링크 주소 - ${url}
*개인 정보 및 합격 전략 노출을 방지하기 위해 링크를 외부 유출하지 말아주세요.`;

  navigator.clipboard.writeText(text).then(() => {
    alert('배포용 문자 내용과 링크가 복사되었습니다. 카카오톡이나 문자 앱에 붙여넣기 하세요.');
  }).catch(err => {
    alert('복사에 실패했습니다: ' + err);
  });
}

function renderMainTable() {
  const headerRow = document.getElementById('table-header-row');
  const tbody = document.getElementById('student-table-body');
  
  const tableControls = document.querySelector('.table-controls');
  if (tableControls) {
    if (CURRENT_ROLE === '학생' || CURRENT_MENU === 'guide' || CURRENT_MENU === 'settings' || CURRENT_MENU === 'user-guide') {
      tableControls.style.display = 'none';
    } else {
      tableControls.style.display = 'flex';
    }
  }
  
  // 메뉴별 필터 제어
  const filterSchool = document.getElementById('filter-target-school');
  const filterYear = document.getElementById('filter-admission-year');
  if (filterSchool) filterSchool.style.display = (CURRENT_MENU === 'dashboard' || CURRENT_MENU === 'info' || CURRENT_MENU === 'record' || CURRENT_MENU === 'ps' || CURRENT_MENU === 'interview') ? 'inline-block' : 'none';
  if (filterYear) filterYear.style.display = (CURRENT_MENU === 'dashboard' || CURRENT_MENU === 'info' || CURRENT_MENU === 'record' || CURRENT_MENU === 'ps' || CURRENT_MENU === 'interview') ? 'inline-block' : 'none';
  
  headerRow.innerHTML = '';
  tbody.innerHTML = '';
  
  // 1. 헤더 생성
  let cols = TABLE_COLUMNS[CURRENT_MENU] || TABLE_COLUMNS.dashboard;
  
  // 관리자가 아닌 경우 AI 채점(recordEval) 열 숨김
  if (CURRENT_MENU === 'record' && CURRENT_ROLE !== '관리자') {
    cols = cols.filter(c => c.key !== 'recordEval');
  }
  
  // 학생인 경우 자소서 피드백(AI) 열 숨김
  if (CURRENT_MENU === 'ps' && CURRENT_ROLE === '학생') {
    cols = cols.filter(c => c.key !== 'psFeedback');
  }
  
  if (CURRENT_ROLE === '학생' && CURRENT_MENU === 'interview') {
    cols = cols.filter(c => c.key !== 'psViewer');
  }

  cols.forEach(col => {
    const th = document.createElement('th');
    th.style.textAlign = 'center';
    
    if (['center', 'name', 'school', 'targetSchool', 'psStatus', 'recordScoreOnly', 'passRound1', 'passFinal'].includes(col.key)) {
      th.style.cursor = 'pointer';
      
      // 기본 상태는 회색 아래쪽 삼각형
      let iconClass = 'fa-caret-down';
      let iconColor = '#777';
      
      // 현재 정렬 중인 컬럼이면 방향 및 녹색 적용
      if (currentSortCol === col.key) {
        iconClass = currentSortDir === 'asc' ? 'fa-caret-up' : 'fa-caret-down';
        iconColor = 'var(--color-primary)';
      }
      
      th.innerHTML = `${col.label} <i class="fa-solid ${iconClass}" style="color: ${iconColor}; font-size: 14px; margin-left: 4px;"></i>`;
      
      th.onclick = () => {
        if (currentSortCol === col.key) {
          currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSortCol = col.key;
          currentSortDir = 'asc';
        }
        renderMainTable();
      };
    } else {
      th.textContent = col.label;
    }
    headerRow.appendChild(th);
  });
  
  // 2. 바디 데이터 생성
  const searchVal = document.getElementById('search-student').value.toLowerCase();
  const targetSchoolVal = document.getElementById('filter-target-school') ? document.getElementById('filter-target-school').value : '전체';
  const admissionYearVal = document.getElementById('filter-admission-year') ? document.getElementById('filter-admission-year').value : '전체';
  const hideHiddenChecked = document.getElementById('checkbox-hide-hidden') ? document.getElementById('checkbox-hide-hidden').checked : true;
  
  const filtered = STUDENTS_LIST.filter(s => {
    // 관리자: 체크박스가 켜져있고 학생이 숨김 상태면 제외 (교사/학생은 원천 차단되어 영향 없음)
    if (hideHiddenChecked && s.is_hidden) return false;

    // 학생일 경우 자신의 데이터만 보이도록 강제 필터링
    if (CURRENT_ROLE === '학생' && s.studentPhone !== CURRENT_STUDENT_ID && s.studentLink !== CURRENT_STUDENT_ID) return false;
    
    const matchSearch = s.name.toLowerCase().includes(searchVal) || s.school.toLowerCase().includes(searchVal);
    const matchSchool = (targetSchoolVal === '전체') || (s.targetSchool === targetSchoolVal);
    const matchYear = (admissionYearVal === '전체') || (s.admissionYear === admissionYearVal);
    return matchSearch && matchSchool && matchYear;
  });

  // 선택된 컬럼 정렬 적용
  if (currentSortCol) {
    filtered.sort((a, b) => {
      let key = currentSortCol === 'recordScoreOnly' ? 'recordScore' : currentSortCol;
      let valA = a[key] || '';
      let valB = b[key] || '';
      
      if (key === 'name') {
        valA = (a.isReference ? '1_' : '0_') + valA;
        valB = (b.isReference ? '1_' : '0_') + valB;
      }
      
      if (key === 'recordScore') {
        let baseA = parseFloat(valA) || 0;
        let baseB = parseFloat(valB) || 0;
        if (baseA !== baseB) return (baseA - baseB) * direction;
        
        let getTb = (str) => {
          let m = String(str).match(/\((.*?)\)/);
          if (!m) return '';
          return m[1].replace(/A/g,'5').replace(/B/g,'4').replace(/C/g,'3').replace(/D/g,'2').replace(/E/g,'1');
        };
        let tbA = getTb(valA);
        let tbB = getTb(valB);
        return tbA > tbB ? 1 * direction : (tbA < tbB ? -1 * direction : 0);
      }
      
      if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
      if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols.length;
    td.className = 'text-muted';
    td.style.textAlign = 'center';
    
    // 로딩 상태에 따른 동적 UI 분기 처리 (1안 적용)
    if (isStudentsDataLoading) {
      td.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; gap:10px; padding: 24px 0;">
                        <span class="spinner" style="width: 22px; height: 22px; border-width: 3px;"></span>
                        <span style="color: var(--color-primary-light); font-weight: 500; font-size: 15px;">서버에서 학생 데이터를 안전하게 불러오는 중입니다... ⏳</span>
                      </div>`;
    } else {
      td.textContent = '조회할 학생 데이터가 존재하지 않습니다.';
    }
    
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  
  filtered.forEach(student => {
    const tr = document.createElement('tr');
    if (student.is_hidden) {
      tr.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
      tr.style.opacity = '0.6';
      tr.title = '숨김(차단) 처리된 학생입니다.';
    }
    
    cols.forEach(col => {
      const td = document.createElement('td');
      td.style.textAlign = 'center';
      const val = student[col.key];
      
      if (student.isReference) {
        const blockedKeys = ['passRound1', 'passFinal', 'studentLink', 'studentSms', 'psStatus', 'psProgress', 'psViewer', 'interviewAssign', 'interviewRecord', 'interviewPs', 'manage'];
        if (blockedKeys.includes(col.key)) {
          if (CURRENT_MENU === 'dashboard' && col.key === 'manage') {
            // 대시보드 메뉴에서는 manage 컬럼(수정 버튼) 예외 허용
          } else {
            td.innerHTML = '<span class="text-muted">-</span>';
            tr.appendChild(td);
            return;
          }
        }
      }
      
      // 특별 컬럼 가공
      if (col.key === 'recordView') {
        if (student.recordPdf) {
          td.innerHTML = `<button class="btn-action" style="padding: 2px 6px; font-size: 14px; background-color: var(--color-secondary); display: inline-flex;" onclick="openPdfPreview('${student.recordPdf}', '${(student.name || '').replace(/'/g, "\\'")}', '${(student.school || '').replace(/'/g, "\\'")}'); return false;"><i class="fa-solid fa-file-pdf"></i> 보기</button>`;
        } else {
          td.innerHTML = `<span class="text-muted">미업로드</span>`;
        }
      }
      else if (col.key === 'recordUpload') {
        if (CURRENT_ROLE === '교사' || CURRENT_ROLE === '관리자') {
          const isReupload = !!student.recordPdf;
          const btnText = isReupload ? '재업로드' : '업로드';
          td.innerHTML = `<button class="btn-action" style="padding: 2px 6px; font-size: 14px; display: inline-flex;" onclick="triggerPdfUpload('${student.studentLink}', ${isReupload})"><i class="fa-solid fa-upload"></i> ${btnText}</button>`;
        } else {
          td.innerHTML = `<span class="text-muted">-</span>`;
        }
      }
      else if (col.key === 'recordScoreOnly') {
        const val = String(student.recordScore || '');
        if (val) {
          if (val.includes('🚨')) {
            td.innerHTML = `<strong>${val.replace(' 🚨', '')} 점 🚨</strong>`;
          } else {
            td.innerHTML = `<strong>${val} 점</strong>`;
          }
        } else {
          td.innerHTML = `<span class="text-muted">-</span>`;
        }
      }
      else if (col.key === 'recordBasis') {
        const val = student.recordScore;
        if (val && (CURRENT_ROLE === '교사' || CURRENT_ROLE === '관리자')) {
          td.innerHTML = `<button class="btn-action" style="padding: 2px 6px; font-size: 14px; background-color: var(--color-secondary); display: inline-flex;" onclick="openScoreDetailsModal('${student.studentLink}')"><i class="fa-solid fa-magnifying-glass"></i> 산정근거</button>`;
        } else {
          td.innerHTML = `<span class="text-muted">-</span>`;
        }
      }
      else if (col.key === 'recordEval') {
        if (CURRENT_ROLE === '관리자') {
          if (student.recordPdf) {
            const btnText = student.recordScore ? '재채점' : 'AI 채점';
            const parseBtnText = student.isParsed ? '재파싱' : 'AI 파싱';
            const parseBtnIcon = student.isParsed ? 'fa-arrows-rotate' : 'fa-play';
            td.innerHTML = `<button class="btn-action" style="padding: 2px 6px; font-size: 14px; background-color: var(--color-primary); display: inline-flex;" onclick="runSingleAIEval('${student.studentLink}')"><i class="fa-solid fa-robot"></i> ${btnText}</button>
                            <button class="btn-action" style="padding: 2px 6px; font-size: 14px; margin-left: 6px; background-color: var(--color-danger); display: inline-flex;" onclick="reparseRecord('${student.studentLink}')"><i class="fa-solid ${parseBtnIcon}"></i> ${parseBtnText}</button>`;
          } else {
            td.innerHTML = `<span class="text-muted">파일없음</span>`;
          }
        }
      } 
      else if (col.key === 'psStatus') {
        let badgeClass = 'gray';
        if (val === '최종제출') badgeClass = 'success';
        else if (val === '작성중') badgeClass = 'warning';
        
        td.innerHTML = `<span class="badge ${badgeClass}">
                          <i class="fa-solid ${val === '최종제출' ? 'fa-lock' : 'fa-lock-open'}"></i> ${val}
                        </span>`;
      }
      else if (col.key === 'psProgress') {
        const targetSchoolName = student.targetSchool;
        const schoolConf = window.findSchoolConfig(targetSchoolName, student.admissionYear);
        
        let totalLimit = 0;
        let totalWritten = 0;
        
        if (schoolConf && schoolConf.questions) {
          const includeSpaces = schoolConf.includeSpaces !== false;
          
          schoolConf.questions.forEach(q => {
            // 1. 단일 문항 limit 추출
            let qLimit = parseInt(q.limit);
            
            // 2. 소문항(details) 중첩 구조 처리: 단일 limit이 없는 경우 소문항 limit 모두 합산
            if (isNaN(qLimit) || qLimit <= 0) {
              if (q.details && q.details.length > 0) {
                qLimit = q.details.reduce((sum, d) => sum + (parseInt(d.limit) || 0), 0);
              } else {
                qLimit = 0;
              }
            }
            
            totalLimit += qLimit;
            
            const qNum = String(q.label).trim();
            const tSchool = (student.targetSchool || '').trim();
            let written = 0;
            
            if (PS_PROGRESS_MAP && PS_PROGRESS_MAP[student.studentLink]) {
              const studentProgress = PS_PROGRESS_MAP[student.studentLink];
              // 1. 현재 타겟 학교 꼬리표가 붙은 최신 데이터 우선 조회
              // 2. 없으면 과거 마이그레이션 예외 처리된 꼬리표 없는('') 데이터로 폴백
              const counts = (studentProgress[tSchool] && studentProgress[tSchool][qNum]) 
                             || (studentProgress[''] && studentProgress[''][qNum]);
                             
              if (counts) {
                written = includeSpaces ? counts.withSpace : counts.noSpace;
              }
            }
            
            if (written > qLimit) written = qLimit;
            totalWritten += written;
          });
        }
        
        if (totalLimit === 0) {
          td.innerHTML = `<span class="text-muted" style="font-size:12px;">정보없음</span>`;
        } else {
          const percent = Math.round((totalWritten / totalLimit) * 100);
          const percentWidth = percent > 100 ? 100 : percent;
          
          // UI: 육안 검증을 위해 명확한 수치 표기 복구 및 정돈된 폭(width) 설정
          td.innerHTML = `
            <div style="position: relative; width: 120px; height: 24px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); margin: 0 auto;">
              <div style="width: ${percentWidth}%; height: 100%; background: linear-gradient(90deg, #5b21b6, #7c3aed); transition: width 0.5s ease;"></div>
              <span style="position: absolute; width: 100%; text-align: center; left: 0; top: 0; line-height: 24px; font-size: 12px; font-weight: 700; color: #ffffff; letter-spacing: 0.5px;">
                ${totalWritten} / ${totalLimit}자
              </span>
            </div>
          `;
        }
      }
      else if (col.key === 'psViewer') {
        td.innerHTML = `<button class="btn-action" style="padding: 4px 8px; font-size: 14px; background-color: var(--color-secondary);" onclick="window.openPsViewerModal('${student.studentLink}')"><i class="fa-solid fa-eye"></i> 자소서 뷰어</button>`;
      } 
      else if (col.key === 'studentAnswers' || col.key === 'questions') {
        let btnAiQuestions = '';
        if (CURRENT_ROLE === '관리자') {
          btnAiQuestions = `<button class="btn-action" style="padding: 2px 6px; font-size: 14px; margin-left: 6px; background-color: var(--color-primary); display: inline-flex;" onclick="runSingleAIQuestions('${student.studentLink}')"><i class="fa-solid fa-comments"></i> 개별생성</button>`;
        }
        if (student.studentAnswers || student.questions === '질문생성완료') {
          td.innerHTML = `<span class="badge success" onclick="openInterviewPractice('${student.studentLink}')" style="cursor:pointer;"><i class="fa-solid fa-comments"></i> 연습하기</span>` + btnAiQuestions;
        } else {
          td.innerHTML = `<span class="text-muted">미생성</span>` + btnAiQuestions;
        }
      } 
      else if (col.key === 'interviewAssign' || col.key === 'interviewRecord' || col.key === 'interviewPs') {
        const isAssign = col.key === 'interviewAssign';
        const isRecord = col.key === 'interviewRecord';
        const typeStr = isAssign ? '공통과제' : (isRecord ? '생기부' : '자소서');
        const modeStr = isAssign ? 'assign' : (isRecord ? 'record' : 'ps');
        const qStatus = String(student.questions || '');
        
        let hasQuestions = false;
        if (qStatus === '질문생성완료' || qStatus.includes(typeStr)) {
          hasQuestions = true;
        }

        let btnGen = '';
        if (CURRENT_ROLE === '관리자') {
          btnGen = `<button class="btn-action" style="padding: 2px 6px; font-size: 14px; margin-left: 6px; background-color: var(--color-primary); display: inline-flex;" onclick="runSingleAIQuestions('${student.studentLink}', '${typeStr}')"><i class="fa-solid fa-comments"></i> ${typeStr} 생성</button>`;
        }
        
        const actionBtnName = CURRENT_ROLE === '학생' ? '연습하기' : '답변 확인';
        const actionBtnIcon = CURRENT_ROLE === '학생' ? 'fa-microphone' : 'fa-eye';
        
        if (hasQuestions) {
          td.innerHTML = `<span class="badge success" onclick="openInterviewPractice('${student.studentLink}', '${modeStr}')" style="cursor:pointer;"><i class="fa-solid ${actionBtnIcon}"></i> ${actionBtnName}</span>` + btnGen;
        } else {
          td.innerHTML = `<span class="text-muted">미생성</span>` + btnGen;
        }
      }
      else if (['passRound1', 'passFinal'].includes(col.key)) {
        if (CURRENT_ROLE === '학생') {
           let badgeClass = 'gray';
           if (val === '합') badgeClass = 'success';
           else if (val === '불') badgeClass = 'danger';
           td.innerHTML = `<span class="badge ${badgeClass}">${val}</span>`;
        } else {
           let isRound1Fail = (student.passRound1 === '불');
           let isRound2Fail = (student.passRound2 === '불');
           
           let disabled = '';
           let forcedVal = val;
           
           if (isRound1Fail && ['passRound2', 'passFinal'].includes(col.key)) {
             disabled = 'disabled';
             forcedVal = '불';
           } else if (isRound2Fail && col.key === 'passFinal') {
             disabled = 'disabled';
             forcedVal = '불';
           }
           
           let statusColor = '#94a3b8';
           let statusIcon = 'fa-circle-dot';
           if (forcedVal === '합') { statusColor = '#10b981'; statusIcon = 'fa-circle-check'; }
           else if (forcedVal === '불') { statusColor = '#ef4444'; statusIcon = 'fa-circle-xmark'; }
           
           let optionsHtml = '';
           optionsHtml = `
                <option value="대기" ${forcedVal === '대기' ? 'selected' : ''}>대기</option>
                <option value="합" ${forcedVal === '합' ? 'selected' : ''}>합</option>
                <option value="불" ${forcedVal === '불' ? 'selected' : ''}>불</option>
                <option value="-" ${forcedVal === '-' ? 'selected' : ''} style="display:none;">-</option>
             `;
           
           td.innerHTML = `
             <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
               <i class="fa-solid ${statusIcon}" id="icon-${student.studentLink}-${col.key}" style="color: ${statusColor}; font-size: 14px;"></i>
               <select class="form-control" style="width:auto; padding:2px 4px; font-size:14px; background:var(--bg-card); color:var(--text-main);" ${disabled} onchange="window.updatePassStatusFrontend('${student.studentLink}', '${col.key}', this.value);">
                  ${optionsHtml}
               </select>
             </div>
           `;
        }
      }
      else if (col.key === 'studentLink') {
        if (CURRENT_ROLE === '학생') {
           td.innerHTML = `<span class="text-muted">-</span>`;
        } else {
           td.innerHTML = `<button class="btn-action" style="padding: 4px 8px; background-color: var(--color-danger);" onclick="navigator.clipboard.writeText(window.location.origin + window.location.pathname + '?student=' + '${student.studentLink}'); alert('배포용 개별 링크가 복사되었습니다.')"><i class="fa-solid fa-link"></i> 링크</button>`;
        }
      }
      else if (col.key === 'studentSms') {
        if (CURRENT_ROLE === '학생') {
           td.innerHTML = `<span class="text-muted">-</span>`;
        } else {
           td.innerHTML = `<button class="btn-action" style="padding: 4px 8px; background-color: #f39c12;" onclick="copySmsTemplate('${student.center}', '${student.name}', '${student.studentLink}')"><i class="fa-solid fa-comment-sms"></i> 문자</button>`;
        }
      }
      else if (col.key === 'manage') {
        if (CURRENT_ROLE === '학생') {
          if (CURRENT_MENU === 'ps') {
             td.innerHTML = `<div style="display: flex; align-items: center; justify-content: center;"><button class="btn-action" style="padding: 4px 8px;" onclick="openPersonalStatementModal('${student.studentLink}')"><i class="fa-solid fa-pen"></i> 본인 자소서 쓰기</button></div>`;
          } else if (CURRENT_MENU === 'interview') {
             td.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; gap:8px;"><button class="btn-action" style="padding: 4px 8px;" onclick="openInterviewPractice('${student.studentLink}')"><i class="fa-solid fa-microphone"></i> 본인 면접 답변하기</button><button class="btn-action" style="padding: 4px 8px; background-color: #8b5cf6;" onclick="openAssignmentPractice('${student.studentLink}', '${student.admissionYear}')"><i class="fa-solid fa-pen-nib"></i> 과제 연습</button></div>`;
          } else {
             td.innerHTML = `<div style="display: flex; align-items: center; justify-content: center;"><span class="text-muted">-</span></div>`;
          }
        } else {
          let buttons = '';
          if (CURRENT_MENU === 'dashboard') {
            buttons = `<button class="btn-action" style="padding: 4px 8px;" onclick="openEditStudent('${student.studentLink}')"><i class="fa-solid fa-gear"></i> 수정</button>`;
          } else if (CURRENT_MENU === 'ps') {
            buttons = `<button class="btn-action" style="padding: 4px 8px; background-color: var(--color-primary);" onclick="openPersonalStatementModal('${student.studentLink}')"><i class="fa-solid fa-pen"></i> 자소서 첨삭</button>`;
          } else if (CURRENT_MENU === 'interview') {
            buttons = `<button class="btn-action" style="padding: 4px 8px; background-color: var(--color-secondary);" onclick="openInterviewPractice('${student.studentLink}')"><i class="fa-solid fa-eye"></i> 답변 확인</button><button class="btn-action" style="padding: 4px 8px; background-color: #8b5cf6;" onclick="openAssignmentPractice('${student.studentLink}', '${student.admissionYear}')"><i class="fa-solid fa-pen-nib"></i> 과제 확인</button>`;
          }
          td.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; gap: 8px;">${buttons}</div>`;
        }
      }
      else if (col.key === 'name') {
        if (val) {
          const nameBg = student.isReference ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.12)';
          const namePrefix = student.isReference ? '[참고] ' : '';
          td.innerHTML = `<span style="background-color: ${nameBg}; padding: 4px 10px; border-radius: 4px; font-weight: 600; color: var(--text-main); display: inline-block;">${namePrefix}${val}</span>`;
        } else {
          td.innerHTML = '<strong>-</strong>';
        }
      }
      else {
        td.textContent = val || '-';
      }
      
      tr.appendChild(td);
    });
    
    tbody.appendChild(tr);
  });
}

/**
 * 테이블 내 행 관리 버튼 (수정 모달 강제 오픈)
 */
function openEditStudent(studentLink) {
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentLink));
  if (!student) return;
  
  isEditMode = true;
  ACTIVE_EDIT_STUDENT_LINK = studentLink;
  document.getElementById('register-modal-title').textContent = '학생 정보 수정';
  document.getElementById('btn-submit-register').textContent = '수정 완료';
  
  // 삭제 버튼 로직
  const deleteGroup = document.getElementById('delete-btn-group');
  const btnHardDelete = document.getElementById('btn-hard-delete-student');
  if (deleteGroup) {
    deleteGroup.style.display = 'flex';
    if (CURRENT_ROLE === '관리자') {
      btnHardDelete.style.display = 'block';
      const btnToggleHidden = document.getElementById('btn-toggle-hidden-student');
      if (btnToggleHidden) {
        btnToggleHidden.style.display = 'block';
        const span = btnToggleHidden.querySelector('span');
        const icon = btnToggleHidden.querySelector('i');
        if (student.is_hidden) {
          span.textContent = '숨김 해제';
          btnToggleHidden.style.backgroundColor = '#10b981';
          icon.className = 'fa-solid fa-eye';
        } else {
          span.textContent = '숨김 처리';
          btnToggleHidden.style.backgroundColor = '#64748b';
          icon.className = 'fa-solid fa-eye-slash';
        }
        
        btnToggleHidden.onclick = function() {
          const newHidden = !student.is_hidden;
          const msg = newHidden 
            ? '이 학생을 숨김 처리하시겠습니까?\n숨김 처리 시 교사 및 학생 본인의 접속이 모두 물리적으로 차단되며 대시보드 리스트에서 가려집니다.' 
            : '이 학생의 숨김을 해제하시겠습니까?\n다시 정상적으로 노출되며 접근이 허용됩니다.';
            
          if (confirm(msg)) {
            ApiClient.post('toggleStudentHidden', { studentLink: student.studentLink || student.id, isHidden: newHidden }, { hideLoader: false }).then(res => {
              if (res && (res.success || res === true)) { // 백엔드 로직에 따라 res.success가 없을수도있음
                alert('처리되었습니다.');
                student.is_hidden = newHidden;
                document.getElementById('modal-register').classList.remove('open');
                loadStudentsData(); // 데이터 재로드 및 렌더링
              } else {
                alert('처리 실패: ' + (res.error || '알 수 없는 오류'));
              }
            });
          }
        };
      }
    } else {
      btnHardDelete.style.display = 'none';
      const btnToggleHidden = document.getElementById('btn-toggle-hidden-student');
      if (btnToggleHidden) btnToggleHidden.style.display = 'none';
    }
    
    btnHardDelete.onclick = function() {
      if(confirm('정말 삭제하시겠습니까? 구글 드라이브의 자소서 파일, 생기부 PDF, 생기부 AI 산출근거, 메인 행까지 모두 완벽하게 영구 삭제됩니다.\n\n이 작업은 절대 되돌릴 수 없습니다!')) {
        ApiClient.post('hardDeleteStudent', { studentLink: student.studentLink }).then(res => {
          if(res.success) {
            alert('성공적으로 모든 DB와 파일이 영구 삭제되었습니다.');
            document.getElementById('modal-register').style.display = 'none';
            STUDENTS_LIST = STUDENTS_LIST.filter(s => s.studentLink !== student.studentLink);
            renderMainTable();
          } else {
            alert('오류: ' + res.error);
          }
        });
      }
    };
  }

  
  document.getElementById('reg-center').value = student.center || '';
  if (document.getElementById('reg-admission-year')) {
    document.getElementById('reg-admission-year').value = student.admissionYear || (new Date().getFullYear() + 1).toString();
  }
  document.getElementById('reg-name').value = student.name || '';
  document.getElementById('reg-school').value = student.school || '';
  document.getElementById('reg-target-school').value = student.targetSchool || '';
  document.getElementById('reg-parent-phone').value = student.parentPhone || '';
  document.getElementById('reg-student-phone').value = student.studentPhone || '';
  document.getElementById('reg-student-phone').removeAttribute('readonly');
  document.getElementById('reg-student-phone').style.backgroundColor = '';
  
  if (document.getElementById('reg-teacher')) {
    document.getElementById('reg-teacher').value = student.teacher || student.mathTeacher || '';
  }
  const refCb = document.getElementById('reg-is-reference');
  if(refCb) refCb.checked = !!student.isReference;
  
  document.getElementById('modal-register').classList.add('open');
}

/**
 * 30가지 생기부 점수 상세 아코디언 토글 렌더러
 */
function toggleScoreAccordion(studentLink, totalScore) {
  if (CURRENT_ROLE === '학생' || CURRENT_ROLE === '게스트') {
    alert('상세 채점 내역 조회 권한이 없습니다. 교사나 관리자만 조회 가능합니다.');
    return;
  }
  openScoreDetailsModal(studentLink);
}

/**
 * 자소서 편집 모달 창 띄우기
 */
let ACTIVE_PS_STUDENT = null;
async function openPersonalStatementModal(studentLink, initialTab = 'manual', targetQNum = null) {
  isPsDirty = false; // 창 열 때 센서 초기화
  ACTIVE_PS_STUDENT = studentLink;
  
  // 방어 로직: 문항 맵이 없으면 세팅 강제 로드
  if (!window.SCHOOL_QUESTIONS_MAP || window.SCHOOL_QUESTIONS_MAP.length === 0) {
    await loadSettingsForm();
  }
  
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentLink));
  if (!student) return;
  
  document.getElementById('ps-modal-title').textContent = `${student.name} 학생의 자기소개서 편집 및 피드백`;
  document.getElementById('ps-school-name').textContent = `지원 학교: ${student.targetSchool || ''}`;
  
  // 락 잠금 여부에 따른 경고 및 버튼 비활성화
  const isLocked = student.psStatus === '최종제출';
  
  const badgeFinalSubmit = document.getElementById('ps-final-submit-badge');
  if (badgeFinalSubmit) {
    badgeFinalSubmit.style.display = isLocked ? 'inline-flex' : 'none';
  }

  const memoPad = document.getElementById('student-memo-pad');
  const btnSaveMemo = document.getElementById('btn-save-memo');
  if (memoPad) {
    memoPad.value = student.student_memo || '';
    const memoTitle = memoPad.closest('.memo-area').querySelector('h4');
    if (memoTitle) {
      const _d = new Date(student.updated_at || Date.now());
      const upDate = `${String(_d.getFullYear()).slice(-2)}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')} ${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
      memoTitle.innerHTML = `학생 메모 <span style="font-size:11px; color:#94a3b8; font-weight:normal;">(기준일: ${upDate})</span>`;
    }
    if (CURRENT_ROLE !== '학생') {
      memoPad.readOnly = true;
      if (btnSaveMemo) btnSaveMemo.style.display = 'none';
    } else {
      memoPad.readOnly = false;
      if (btnSaveMemo) btnSaveMemo.style.display = 'inline-block';
    }
    // btnSaveMemo.onclick 중복 바인딩 삭제 (DOMContentLoaded에서 window.saveMemo로 단일 바인딩 됨)
  }
  
  const btnGenerateChecklist = document.getElementById('btn-generate-ai-checklist');
  if (btnGenerateChecklist) {
    btnGenerateChecklist.style.display = 'inline-block';
  }
  const btnResetChecklist = document.getElementById('btn-reset-ai-checklist');
  if (btnResetChecklist) {
    btnResetChecklist.style.display = (CURRENT_ROLE === '관리자') ? 'inline-block' : 'none';
  }
  
  const alertBox = document.getElementById('ps-lock-warning-alert');
  const txtArea = document.getElementById('ps-content-textarea');
  const saveBtn = document.getElementById('btn-save-ps');
  const submitBtn = document.getElementById('btn-submit-ps-final');
  
  if (CURRENT_ROLE === '교사' || CURRENT_ROLE === '관리자') {
    txtArea.readOnly = true;
    saveBtn.style.display = 'inline-block'; // 피드백 일괄 저장 허용
    saveBtn.textContent = '피드백 저장';
    submitBtn.style.display = 'none';
    alertBox.style.display = 'none';
    
    // 관리자인 경우 락 해제(반려) 버튼 제공
    if (CURRENT_ROLE === '관리자' && isLocked) {
      let unlockBtn = document.getElementById('btn-unlock-ps-action');
      if (!unlockBtn) {
        unlockBtn = document.createElement('button');
        unlockBtn.className = 'btn-action';
        unlockBtn.id = 'btn-unlock-ps-action';
        unlockBtn.style.backgroundColor = 'var(--color-danger)';
        unlockBtn.textContent = '🔓 최종 제출 반려 및 락 해제';
        unlockBtn.onclick = async () => {
          if (confirm('최종 제출을 반려하고 수정을 허용하시겠습니까?')) {
            const inputPw = sessionStorage.getItem('user_pw') || '';
            try {
              const res = await ApiClient.post('unlockPersonalStatement', { studentId: studentLink, adminPassword: inputPw });
              if (res && res.success) {
                alert('락이 해제되었습니다. 모달을 다시 열어주십시오.');
                document.getElementById('modal-ps-editor').classList.remove('open');
                loadStudentsData();
              } else {
                alert('비밀번호가 일치하지 않거나 반려에 실패했습니다.');
              }
            } catch (e) {
              alert('반려 실패: ' + e.message);
            }
          }
        };
        document.getElementById('ps-modal-footer').insertBefore(unlockBtn, saveBtn);
      }
    } else {
      const unlockBtn = document.getElementById('btn-unlock-ps-action');
      if (unlockBtn) unlockBtn.remove();
    }
  } else {
    // For student
    if (isLocked) {
      alertBox.style.display = 'flex';
      txtArea.readOnly = true;
      saveBtn.style.display = 'none';
      submitBtn.style.display = 'none';
    } else {
      alertBox.style.display = 'none';
      txtArea.readOnly = false;
      saveBtn.style.display = 'block';
      submitBtn.style.display = 'block';
    }
  }
  
  // 8.1 학생 권한 진입 시 '선생님 수기 피드백 입력창' 강제 readOnly 설정
  const feedbackTextarea = document.getElementById('manual-feedback-textarea');
  if (CURRENT_ROLE === '학생') {
    feedbackTextarea.readOnly = true;
    feedbackTextarea.disabled = true;
    feedbackTextarea.placeholder = "🔒 선생님 문항별 피드백 조회 전용 영역입니다. 학생은 수정할 수 없습니다.";
    feedbackTextarea.style.background = "rgba(255, 255, 255, 0.02)";
  } else {
    feedbackTextarea.readOnly = false;
    feedbackTextarea.disabled = false;
    feedbackTextarea.placeholder = "학생을 위한 보완점 및 문항별 피드백을 기록하십시오...";
    feedbackTextarea.style.background = "rgba(0, 0, 0, 0.2)";
  }
  
  window.normalizeQNum = function(str) {
    if (!str) return '';
    return String(str).replace(/^문항\s*/, '').replace(/\s+/g, '').trim();
  };
  
  // 동적 질문 바인딩 (학교별 맞춤 문항 연동)
  const schoolMap = window.SCHOOL_QUESTIONS_MAP || [];
  const studentSchool = (student.targetSchool || '').trim();
  const studentYear = (student.admissionYear || '').trim();
  
  // 1순위: 학교명과 학년도가 모두 일치하는 세트
  let matchedSchool = schoolMap.find(s => s.name === studentSchool && (s.admissionYear || '').trim() === studentYear);
  
  // 2순위: 정확히 일치하는 학년도가 없으면, 동일한 학교명 중 학년도가 비어있는(기본) 세트 탐색
  if (!matchedSchool) {
    matchedSchool = schoolMap.find(s => s.name === studentSchool && !(s.admissionYear || '').trim());
  }
  
  // 3순위: 위 조건에 모두 실패 시 이름만 일치하는 첫 번째 항목으로 폴백
  if (!matchedSchool) {
    matchedSchool = schoolMap.find(s => s.name === studentSchool);
  }
  
  const questions = (matchedSchool && matchedSchool.questions && matchedSchool.questions.length > 0)
    ? matchedSchool.questions
    : [{ label: '문항 1', content: '자기소개서 문항이 설정되지 않았습니다.', limit: '' }];
    
  const psSelector = document.getElementById('ps-question-selector');
  if (psSelector) {
    psSelector.innerHTML = '';
    questions.forEach((q, idx) => {
      let shortLabel = q.label.trim();
      let fullQuestionText = "";
      
      const opt = document.createElement('option');
      const compositeKey = studentSchool + '|' + shortLabel;
      opt.value = compositeKey;
      // OS 다크모드 렌더링 충돌 방지를 위해 JS 인라인 스타일을 다시 강제 주입 (캐시 무시)
      opt.style.backgroundColor = '#1e293b';
      opt.style.color = '#f8fafc';
      
      // 드롭다운에는 짧은 텍스트만 렌더링
      opt.textContent = `[${studentSchool}] ${shortLabel}`; 
      
      let textToShow = fullQuestionText;
      // 추가 content 데이터가 있다면 합치기
      if (q.content && q.content.trim() !== '') {
        textToShow = textToShow ? textToShow + " " + q.content : q.content;
      }
      if (q.limit) textToShow += ` (제한: ${q.limit}자)`;
      
      // 분리된 긴 질문 텍스트는 전용 단락용 dataset에 저장
      opt.dataset.qtext = textToShow;
      psSelector.appendChild(opt);
    });
  }
  
  try {
    const reqPw = sessionStorage.getItem('user_pw') || '';
    const historyData = await ApiClient.post('getPersonalStatementHistory', {
      studentId: studentLink,
      clientRole: CURRENT_ROLE,
      authPw: reqPw
    });
    
    if (!historyData.current) historyData.current = [];
    const maxQNum = questions.length;
    questions.forEach((q, idx) => {
      const qVal = q.label.trim();
      if (!historyData.current.find(c => window.normalizeQNum(c.qNum) === window.normalizeQNum(qVal))) {
        historyData.current.push({ qNum: qVal, text: '', feedback: '', version_label: studentSchool });
      }
    });
    
    // 쓰레기 데이터 원천 필터링 (과거 버그로 생성된 1, 2, '최신' 등 껍데기 유령 데이터 차단)
    // 쓰레기 데이터 원천 필터링 로직 통째로 무력화 (진짜 데이터 증발 위험 차단)
    /*
    const validLabels = questions.map(q => q.label.trim());
    historyData.current = historyData.current.filter(c => {
      if (c.version_label === '최신') return false;
      if (!isNaN(c.qNum) && c.version_label === studentSchool) return validLabels.some(v => window.normalizeQNum(v) === window.normalizeQNum(c.qNum));
      return true;
    });
    */
    
    // 글로벌에 데이터 홀드
    window.PS_CURRENT_HISTORY = historyData;
    window.PS_ORIGINAL_HISTORY_CURRENT = JSON.parse(JSON.stringify(historyData.current || []));
    
    // 타학교 미아 데이터 드롭다운 꼬리표 추가 (문항 번호순 정렬 보장)
    const oldItems = historyData.current.filter(curr => {
      const cLabel = (curr.version_label || '').trim();
      return cLabel && cLabel !== studentSchool;
    });

    // 문항 1, 문항 1-1, 문항 2-1 순서로 논리적 정렬 (단순 문자열 정렬 시 10번이 2번보다 앞에 오는 버그 방지)
    oldItems.sort((a, b) => {
      const parseNum = (str) => {
        const m = String(str).match(/(\d+)(?:-(\d+))?/);
        if (!m) return [999, 999]; // 숫자가 없으면 맨 뒤로
        return [parseInt(m[1]), parseInt(m[2] || 0)];
      };
      
      const numA = parseNum(a.qNum);
      const numB = parseNum(b.qNum);
      
      // 1. 학교 이름표(version_label)로 먼저 그룹핑 (예: 진산과고끼리, 인과고끼리 묶음)
      const labelA = (a.version_label || '').trim();
      const labelB = (b.version_label || '').trim();
      if (labelA !== labelB) return labelA.localeCompare(labelB);
      
      // 2. 같은 학교 내에서는 대문항 번호 정렬
      if (numA[0] !== numB[0]) return numA[0] - numB[0];
      // 3. 대문항이 같으면 소문항 번호 정렬
      return numA[1] - numB[1];
    });

    oldItems.forEach(curr => {
      const compositeKey = curr.version_label + '|' + curr.qNum;
      const exists = Array.from(psSelector.options).some(o => o.value === compositeKey);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = compositeKey;
        opt.style.backgroundColor = '#1e293b';
        opt.style.color = '#f8fafc';
        let displayQNum = String(curr.qNum).startsWith('문항') ? String(curr.qNum) : `문항 ${curr.qNum}`;
        opt.textContent = `(구) [${curr.version_label}] ${displayQNum}`;
        opt.dataset.qtext = curr.question || '';
        psSelector.appendChild(opt);
      }
    });
    
    // 문항 셀렉트 로드 (보고 있던 문항 번호가 있으면 우선 복구)
    let defaultQNum = psSelector.options.length > 0 ? psSelector.options[0].value : (studentSchool + '|문항 1');
    if (targetQNum) {
      // targetQNum이 복합키가 아니라 단순 '문항 1'로 올 수 있으므로 보정
      let searchKey = targetQNum.includes('|') ? targetQNum : (studentSchool + '|' + targetQNum);
      const exists = Array.from(psSelector.options).some(o => o.value === searchKey);
      if (exists) defaultQNum = searchKey;
    }
    psSelector.value = defaultQNum;
    bindPersonalStatementToSelector(defaultQNum);
    
  } catch (err) {
    console.error('이력 로드 실패:', err);
  }
  
  // 탭 강제 전환
  switchTab(initialTab);
  
  if (CURRENT_ROLE === '학생') {
    const btnGen = document.getElementById('btn-generate-ai-checklist');
    const btnReset = document.getElementById('btn-reset-ai-checklist');
    if (btnGen) btnGen.style.display = 'none';
    if (btnReset) btnReset.style.display = 'none';
  } else {
    const btnGen = document.getElementById('btn-generate-ai-checklist');
    const btnReset = document.getElementById('btn-reset-ai-checklist');
    if (btnGen) btnGen.style.display = 'inline-block';
    if (btnReset) btnReset.style.display = (CURRENT_ROLE === '관리자') ? 'inline-block' : 'none';
  }
  
  document.getElementById('modal-ps-editor').classList.add('open');
}

/**
 * 탭 스위칭 엔진
 */
function switchTab(tabId) {
  const manualBtn = document.getElementById('tab-btn-manual-feedback');
  const aiBtn = document.getElementById('tab-btn-ai-feedback');
  const manualContent = document.getElementById('tab-content-manual');
  const aiContent = document.getElementById('tab-content-ai');
  
  if (tabId === 'manual') {
    manualBtn.classList.add('active');
    aiBtn.classList.remove('active');
    manualContent.classList.add('active');
    aiContent.classList.remove('active');
  } else {
    // 보안 제어: 학생 권한인 경우 AI 탭 접근 불허
    if (CURRENT_ROLE === '학생') {
      alert('보안 규정 상 학생 계정은 AI 피드백 탭에 접근할 수 없습니다.');
      return;
    }
    aiBtn.classList.add('active');
    manualBtn.classList.remove('active');
    aiContent.classList.add('active');
    manualContent.classList.remove('active');
    
    // AI 피드백 바인드
    const aiContainer = document.getElementById('ai-feedback-container');
    const aiLog = window.PS_CURRENT_HISTORY.aiHistory || [];
    const genBtn = document.getElementById('btn-generate-ai-feedback');
    if (genBtn) genBtn.style.display = (CURRENT_ROLE === '관리자' || CURRENT_ROLE === '교사') ? 'inline-block' : 'none';
    const resetFbBtn = document.getElementById('btn-reset-ai-feedback');
    if (resetFbBtn) resetFbBtn.style.display = (CURRENT_ROLE === '관리자') ? 'inline-block' : 'none';
    const qNum = document.getElementById('ps-question-selector').value;
    const newType = '문항[' + qNum + ']_도움받기';
    let targetAILogs = aiLog.filter(log => log.type === newType);
    const dateEl = document.getElementById('ai-feedback-date-text');
    if (targetAILogs.length > 0) {
      const lastLog = targetAILogs[targetAILogs.length - 1];
      aiContainer.innerHTML = parseMarkdown(lastLog.feedback); // 최신 AI 피드백
      if (dateEl && lastLog.timestamp) {
        const _d = new Date(lastLog.timestamp);
        const fmtDate = `${String(_d.getFullYear()).slice(-2)}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')} ${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
        dateEl.textContent = `(기준일: ${fmtDate})`;
        dateEl.style.display = 'block';
      }
    } else {
      if (dateEl) dateEl.style.display = 'none';
      aiContainer.innerHTML = `<div style="text-align:center; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; color: var(--text-muted); word-break: keep-all; padding: 10px;">
                                 아직 생성된 AI 피드백이 없습니다.
                               </div>`;
    }
  }
}

/**
 * 글자 수 계산 헬퍼 함수 (공백 포함 여부 옵션 지원)
 */
function getCharCount(text, schoolName, admissionYear) {
  if (!text) return 0;
  const schoolConf = window.findSchoolConfig(schoolName, admissionYear);
  if (schoolConf && schoolConf.includeSpaces === false) {
    return text.replace(/\s+/g, '').length;
  }
  return text.length;
}

/**
 * JSON 형태의 AI 체크리스트 데이터를 프리미엄 3단 구조 HTML로 변환합니다.
 */
function renderChecklistToHTML(jsonString) {
  try {
    const cleanStr = jsonString.replace(/^```(json)?\n?/i, '').replace(/```$/i, '').trim();
    const data = JSON.parse(cleanStr);
    
    let exclusionsHTML = '';
    if (data.exclusions) {
      if (data.exclusions.found) {
        exclusionsHTML = `<div style="background-color: #fee2e2; color: #991b1b; padding: 12px; margin-bottom: 15px; border-radius: 4px; font-weight: bold;">
          🔴 [위반 감지] 감점/결격 위험 문장이 발견되었습니다.<br>
          <span style="opacity:0.8; font-weight: normal; font-size: 13px;">예시: ${data.exclusions.detail}</span>
        </div>`;
      } else {
        exclusionsHTML = `<div style="background-color: #dcfce7; color: #166534; padding: 12px; margin-bottom: 15px; border-radius: 4px; font-weight: bold;">
          🟢 0점 처리되는 외부 수상, 친인척 지위 등의 결격사항이 없습니다.
        </div>`;
      }
    }

    let checklistHTML = '';
    if (data.checklist && data.checklist.length > 0) {
      const rows = data.checklist.map(item => {
        let badgeHTML = '';
        if (item.status === '완료') {
          badgeHTML = `<span class="badge" style="background:#10b981; color:#fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">[완료]</span>`;
        } else if (item.status === '위기') {
          badgeHTML = `<span class="badge" style="background:#ef4444; color:#fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">[위기]</span>`;
        } else {
          badgeHTML = `<span class="badge" style="background:#f59e0b; color:#fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">[보완]</span>`;
        }
        let displayCategory = item.category;
        switch (displayCategory) {
          case '제목 적합성': displayCategory = '제목/주제<br>적합성'; break;
          case '시행착오 및 막힌 지점': displayCategory = '시행착오<br>및<br>막힌 지점'; break;
          case '구체적 수치/데이터':
          case '구체적 수치 및 데이터 활용':
          case '탐구 구체성 및 데이터 활용': displayCategory = '탐구 구체성<br>및<br>데이터 활용'; break;
          case '주어 및 관점': displayCategory = '주어 및<br>관점'; break;
          case '탐구 계기 연계': displayCategory = '탐구 계기<br>연계'; break;
          case '특화 환경 지목': displayCategory = '특화 환경<br>지목'; break;
          case '관심 분야 명시': displayCategory = '관심 분야<br>명시'; break;
          case '구체적 상황': displayCategory = '구체적<br>상황'; break;
          case '본인의 직접 행동': displayCategory = '본인의<br>직접 행동'; break;
          case '행동 및 태도 변화': displayCategory = '행동 및<br>태도 변화'; break;
          case '관점의 비교·대조':
          case '관점의 비교 대조': displayCategory = '관점의<br>비교 대조'; break;
          case '진로/학업 영향':
          case '진로 및 학업 영향':
          case '진로 및 학업 역량': displayCategory = '진로 및<br>학업 역량'; break;
          case '해결 방안 구체성': displayCategory = '해결 방안<br>구체성'; break;
          default:
            if (displayCategory.includes('시행착오 및 막힌 지점')) displayCategory = '시행착오<br>및<br>막힌 지점';
            else if (displayCategory.includes('구체적 수치')) displayCategory = '구체적 수치<br>및<br>데이터 활용';
            else if (displayCategory.includes('관점의 비교')) displayCategory = '관점의<br>비교 대조';
            else if (displayCategory.includes('진로 및 학업') || displayCategory.includes('진로/학업')) displayCategory = '진로 및<br>학업 역량';
            else if (displayCategory.includes('해결 방안')) displayCategory = '해결 방안<br>구체성';
        }

        return `
          <div style="display: contents;">
            <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); color: #e2e8f0; font-size: 13px; font-weight: bold; text-align: center; line-height: 1.5; display: flex; flex-direction: column; justify-content: center;">${displayCategory}</div>
            <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center;">${badgeHTML}</div>
            <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 13px; display: flex; flex-direction: column; justify-content: center; line-height: 1.6;">${item.feedback}</div>
          </div>
        `;
      }).join('');

      checklistHTML = `
        <div style="display: grid; grid-template-columns: 1fr 0.8fr 3.2fr; gap: 10px; background: #1e293b; padding: 15px; border-radius: 8px;">
          <div style="font-weight: bold; color: #94a3b8; padding-bottom: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); text-align: center;">체크 항목</div>
          <div style="font-weight: bold; color: #94a3b8; padding-bottom: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); text-align: center;">상태</div>
          <div style="font-weight: bold; color: #94a3b8; padding-bottom: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); text-align: center;">주요 확인사항</div>
          ${rows}
        </div>
      `;
    }

    return `<div class="ai-checklist-premium">
      ${exclusionsHTML}
      ${checklistHTML}
    </div>`;
  } catch (err) {
    console.error('Checklist JSON Parse Error:', err);
    return parseMarkdown(jsonString);
  }
}

/**
 * 특정 문항을 선택했을 때 자소서 및 수기 피드백 내용을 바인드
 */
function bindPersonalStatementToSelector(compositeQNum) {
  const hData = window.PS_CURRENT_HISTORY;
  if (!hData) return;
  
  const uiTargetSchool = document.getElementById('ps-school-name').textContent.replace('지원 학교: ', '');
  const [targetSchoolKey, targetQNumKey] = compositeQNum.includes('|') ? compositeQNum.split('|') : [uiTargetSchool, compositeQNum];
  
  // 최신 자소서 로드
  const curr = hData.current.find(c => {
    const cleanV = (c.version_label || '').trim();
    const cleanT = (targetSchoolKey || '').trim();
    const cleanUi = (uiTargetSchool || '').trim();
    return window.normalizeQNum(c.qNum) === window.normalizeQNum(targetQNumKey) && (cleanV === cleanT || (!cleanV && cleanT === cleanUi));
  });
  const textVal = curr ? curr.text : '';
  const feedbackVal = curr ? curr.feedback : '';
  
  // 글자 수 헬퍼 함수 사용 시 원본 targetSchool 대신 데이터의 소속 학교를 사용해야 함
  const targetSchool = targetSchoolKey;
  
  // 질문 텍스트 표시
  const psSel = document.getElementById('ps-question-selector');
  if (psSel && psSel.options[psSel.selectedIndex]) {
    const qText = psSel.options[psSel.selectedIndex].dataset.qtext || '';
    const displayEl = document.getElementById('ps-question-display-text');
    if (displayEl) displayEl.textContent = qText;
  }
  
  // 헬퍼 함수
  if (!window.getCurrentPsText) {
    window.getCurrentPsText = function(forAi = false) {
      const container = document.getElementById('ps-dynamic-details-container');
      if (container && container.style.display !== 'none') {
        const tas = container.querySelectorAll('.dynamic-ps-textarea');
        const vals = Array.from(tas).map(ta => ta.value.trim());
        if (forAi) {
          const wrappers = container.children;
          const labeled = Array.from(tas).map((ta, idx) => {
            const labelText = wrappers[idx] ? wrappers[idx].children[0].textContent : '';
            const val = ta.value.trim();
            if (labelText) {
              return '[' + labelText + ']:\n' + (val || '(내용 없음)');
            }
            return val;
          });
          return labeled.join('\n\n[상세분할]\n\n');
        } else {
          return vals.join('[상세분할]');
        }
      } else {
        return document.getElementById('ps-content-textarea').value;
      }
    };
  }
  
  const container = document.getElementById('ps-dynamic-details-container');
  const txtArea = document.getElementById('ps-content-textarea');
  const countWrap = document.getElementById('ps-main-char-counter-wrap');
  
  const schoolMap = window.SCHOOL_QUESTIONS_MAP || [];
  const matchedSchool = window.findSchoolConfig(targetSchoolKey, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
  const qData = matchedSchool && matchedSchool.questions ? matchedSchool.questions.find(q => {
    return window.normalizeQNum(q.label) === window.normalizeQNum(targetQNumKey);
  }) : null;
  const details = qData && qData.details ? qData.details : [];

  const isLocked = window.ACTIVE_PS_STUDENT_STATUS === '최종제출'; // Need locked status? Actually it's set on modal open, let's just check student.psStatus
  const studentInfo = STUDENTS_LIST.find(s => String(s.studentLink) === String(ACTIVE_PS_STUDENT));
  const locked = studentInfo && studentInfo.psStatus === '최종제출';

  if (details.length > 0) {
    txtArea.style.display = 'none';
    if (countWrap) countWrap.style.display = 'none';
    container.style.display = 'flex';
    container.innerHTML = '';
    
    let parts = [];
    if (textVal.includes('[상세분할]')) {
      parts = textVal.split('[상세분할]');
    } else {
      parts = [textVal];
    }

    details.forEach((det, idx) => {
      const partVal = parts[idx] ? parts[idx].trim() : (idx === 0 && parts.length === 1 && !textVal.includes('[상세분할]') ? textVal : '');
      
      const limitNum = parseInt(det.limit, 10);
      const flexRatio = (isNaN(limitNum) || limitNum <= 0) ? 100 : limitNum;
      const minH = Math.max(60, Math.min(300, flexRatio * 0.4 + 40));
      
      const div = document.createElement('div');
      div.style.cssText = `display: flex; flex-direction: column; gap: 5px; flex: ${flexRatio}; position: relative; min-height: ${minH + 30}px;`;
      
      const title = document.createElement('div');
      title.style.cssText = "color: #10b981; font-weight: bold; font-size: 14px;";
      title.textContent = det.title;
      
      const ta = document.createElement('textarea');
      ta.className = 'form-control dynamic-ps-textarea';
      ta.style.cssText = `flex: 1; min-height: ${minH}px; resize: none; line-height: 1.5; padding: 12px; font-size: 14px; background: rgba(0,0,0,0.2); margin-bottom: 5px;`;
      ta.placeholder = "소문항 답변을 입력하세요...";
      if (CURRENT_ROLE === '교사' || CURRENT_ROLE === '관리자' || locked) {
        ta.readOnly = true;
      }
      ta.value = partVal;
      
      const charCounter = document.createElement('div');
      charCounter.className = 'char-counter';
      charCounter.style.cssText = "text-align: right; font-size: 12px; color: #94a3b8;";
      charCounter.innerHTML = `<span class="dyn-count">0</span> 자 / <span style="color:#64748b">${det.limit || '-'}</span> 자`;
      
      ta.oninput = () => {
         // 개별 칸 글자 수 표시
         const cnt = getCharCount(ta.value, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
         charCounter.querySelector('.dyn-count').textContent = cnt;
         
         // 전체 글자수 및 로컬 자동 기억(캐시) 업데이트
         const combined = window.getCurrentPsText ? window.getCurrentPsText(false) : ta.value;
         const cleanTextForCount = combined.replace(/\[상세분할\]/g, '');
         const totalCnt = getCharCount(cleanTextForCount, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
         document.getElementById('ps-char-count').textContent = totalCnt;
         
         const currentQNum = document.getElementById('ps-question-selector').value;
         const uiTargetSchool = document.getElementById('ps-school-name').textContent.replace('지원 학교: ', '');
         const [tSchool, tQNum] = currentQNum.includes('|') ? currentQNum.split('|') : [uiTargetSchool, currentQNum];
         const hData = window.PS_CURRENT_HISTORY;
         if (hData && hData.current) {
           const curr = hData.current.find(c => window.normalizeQNum(c.qNum) === window.normalizeQNum(tQNum) && (c.version_label === tSchool || (!c.version_label && tSchool === uiTargetSchool)));
           if (curr) {
             curr.text = combined;
             isPsDirty = true;
           }
         }
      };
      // 초기 렌더링 시에는 히스토리 업데이트 없이 글자 수 표기만
      charCounter.querySelector('.dyn-count').textContent = getCharCount(ta.value, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
      
      div.appendChild(title);
      div.appendChild(ta);
      div.appendChild(charCounter);
      
      container.appendChild(div);
    });
    
    // 다중 칸일 경우, 렌더링 직후 초기 전체 글자수 세팅
    if (countWrap) countWrap.style.display = 'none'; // 중복 표시 방지
    const combinedInit = textVal;
    const cleanInitText = combinedInit.replace(/\[상세분할\]/g, '');
    document.getElementById('ps-char-count').textContent = getCharCount(cleanInitText, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);

  } else {
    container.style.display = 'none';
    txtArea.style.display = 'block';
    if (countWrap) countWrap.style.display = 'block';
    txtArea.value = textVal;
    document.getElementById('ps-char-count').textContent = getCharCount(textVal, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
    const limitEl = document.getElementById('ps-main-char-limit');
    if (limitEl) limitEl.textContent = (qData && qData.limit) ? qData.limit : '-';
  }

  const manualFbArea = document.getElementById('manual-feedback-textarea');
  const manualFbOverlay = document.getElementById('manual-feedback-empty-overlay');
  manualFbArea.value = feedbackVal;
  
  if (CURRENT_ROLE === '학생') {
    manualFbArea.readOnly = true;
    if (!feedbackVal || feedbackVal.trim() === '') {
      manualFbArea.style.display = 'none';
      if(manualFbOverlay) manualFbOverlay.style.display = 'flex';
    } else {
      manualFbArea.style.display = 'block';
      if(manualFbOverlay) manualFbOverlay.style.display = 'none';
    }
  } else {
    manualFbArea.readOnly = false;
    manualFbArea.style.display = 'block';
    if(manualFbOverlay) manualFbOverlay.style.display = 'none';
  }
  
  // AI 체크리스트 바인딩 (해당 문항의 최신 내역 로드)
  const checklistContainer = document.getElementById('ai-checklist-container');
  if (checklistContainer) {
    const aiLogs = hData.aiHistory || [];
    const newType = '문항[' + compositeQNum + ']_체크리스트';
    let matchingLogs = aiLogs.filter(log => log.type === newType);
    if (matchingLogs.length > 0) {
      const lastLog = matchingLogs[matchingLogs.length - 1];
      checklistContainer.innerHTML = renderChecklistToHTML(lastLog.feedback);
      const chkTitle = checklistContainer.closest('.checklist-area').querySelector('h4');
      if (chkTitle) {
        const _d = new Date(lastLog.timestamp);
        const fmtDate = `${String(_d.getFullYear()).slice(-2)}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')} ${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
        chkTitle.innerHTML = `항목별 체크리스트 확인하기 <span style="font-size:11px; color:#94a3b8; font-weight:normal;">(기준일: ${fmtDate})</span>`;
      }
    } else {
      checklistContainer.innerHTML = `<div style="color: var(--text-muted); text-align: center; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.6; word-break: keep-all; padding: 10px;">
        🚫 기재하면 절대 안되는 사항이나<br>질문의 핵심요점과 어울리지 않는지 등을 체크합니다.<br><br>📝 적어도 자소서 초안이 입력되어야만,<br>선생님들이 확인하여 작성할 수 있습니다.
      </div>`;
      const chkTitle = checklistContainer.closest('.checklist-area').querySelector('h4');
      if (chkTitle) chkTitle.innerHTML = `항목별 체크리스트 확인하기`;
    }
  }
  
  // AI 도움받기 바인딩 (해당 문항의 최신 내역 로드)
  const aiContainer = document.getElementById('ai-feedback-container');
  const aiDateEl = document.getElementById('ai-feedback-date-text');
  if (aiContainer) {
    const aiLog = hData.aiHistory || [];
    const newType = '문항[' + compositeQNum + ']_도움받기';
    let targetAILogs = aiLog.filter(log => log.type === newType);
    if (targetAILogs.length > 0) {
      const lastLog = targetAILogs[targetAILogs.length - 1];
      aiContainer.innerHTML = parseMarkdown(lastLog.feedback);
      if (aiDateEl && lastLog.timestamp) {
        const _d = new Date(lastLog.timestamp);
        const fmtDate = `${String(_d.getFullYear()).slice(-2)}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')} ${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
        aiDateEl.textContent = `(기준일: ${fmtDate})`;
        aiDateEl.style.display = 'block';
      }
    } else {
      if (aiDateEl) aiDateEl.style.display = 'none';
      aiContainer.innerHTML = `<div style="text-align:center; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; color: var(--text-muted); word-break: keep-all; padding: 10px;">
                                 아직 생성된 AI 피드백이 없습니다.
                               </div>`;
    }
  }
  
  // 타임머신 드롭다운 내용 갱신
  const historySelector = document.getElementById('ps-history-selector');
  if (historySelector && window.PS_CURRENT_HISTORY) {
    historySelector.innerHTML = '<option value="" style="background-color: #1e293b; color: #f8fafc;">과거 버전 선택</option>';
    const historyList = window.PS_CURRENT_HISTORY.history || [];
    
    let lastText = '';
    historyList.forEach((h, index) => {
      const textObj = h.texts.find(t => {
        const cleanV = (t.version_label || '').trim();
        const cleanT = (targetSchoolKey || '').trim();
        const cleanUi = (uiTargetSchool || '').trim();
        return window.normalizeQNum(t.qNum) === window.normalizeQNum(targetQNumKey) && (cleanV === cleanT || (!cleanV && cleanT === cleanUi));
      });
      if (textObj && textObj.text && textObj.text !== lastText) {
        const opt = document.createElement('option');
        opt.value = textObj.text;
        opt.dataset.timestamp = h.timestamp; // (구버전 호환용)
        opt.dataset.record_id = textObj.id; // 삭제용 고유 ID
        opt.textContent = formatTimestamp(h.timestamp);
        opt.style.backgroundColor = '#1e293b';
        opt.style.color = '#f8fafc';
        historySelector.appendChild(opt);
        lastText = textObj.text;
      }
    });

    // 드롭다운 항목 중 가장 최신 버전과 직전 버전을 찾아서 보호 처리
    // historyList는 최신순(내림차순)으로 정렬되어 있으므로, 
    // opts[0]은 "과거 버전 선택"
    // opts[1]은 가장 최신 버전
    // opts[2]는 직전(두 번째 최신) 버전
    const opts = historySelector.options;
    if (opts.length > 1) {
      opts[1].dataset.is_protected = "true";
      opts[1].textContent += " (최신)";
    }

  }
}



/**
 * 예상 질문 연습 창 모달 띄우기
 */
let ACTIVE_INTERVIEW_STUDENT = null;
let ACTIVE_INTERVIEW_MODE = "ps";
async function openInterviewPractice(studentLink, mode) {
  ACTIVE_INTERVIEW_STUDENT = studentLink;
  ACTIVE_INTERVIEW_MODE = mode || "ps";
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentLink));
  if (!student) return;
  
  const isPsMode = ACTIVE_INTERVIEW_MODE === "ps";
  document.getElementById('interview-modal-title').textContent = `${student.name} 학생 예상 면접 질문 연습 (${isPsMode ? '자소서' : '생기부'} 기반)`;
  

  
  const qList = document.getElementById('interview-question-list');
  qList.innerHTML = '<p class="text-muted" style="padding: 20px;">예상 질문을 서버에서 조회 중입니다...</p>';
  
  let questionsData = { psQuestions: '', recordQuestions: '' };
  try {
    questionsData = await ApiClient.post('getAIQuestions', { studentId: studentLink });
  } catch (e) {
    console.error('질문 조회 실패', e);
  }
  
  qList.innerHTML = '';
  
  // 모달 열 때 우측 질문/답변 영역 초기화 (이전 탭 잔여물 제거)
  document.getElementById('selected-question-label').textContent = '좌측에서 질문을 선택하십시오.';
  document.getElementById('modal-question-text').innerHTML = '';
  document.getElementById('interview-answer-textarea').value = '';
  document.getElementById('interview-answer-textarea').readOnly = true;
  document.getElementById('interview-answer-textarea').placeholder = '좌측 목록에서 답변할 질문을 먼저 선택해 주세요.';
  document.getElementById('btn-save-interview-answer').style.display = 'none';
  const indicator = document.getElementById('changed-questions-indicator');
  if (indicator) indicator.innerHTML = '';
  
  // 질문 텍스트를 세트 단위(### 기준)로 파싱하는 함수
  function parseQuestionSets(rawText) {
    if (!rawText) return [];
    
    let jsonArray = [];
    try {
      // AI가 마크다운 코드블록(```json)을 씌워 보낼 경우를 대비한 껍데기 제거 (파싱 에러 0% 방어막)
      const cleanStr = rawText.replace(/^```(json)?\n?/i, '').replace(/```$/i, '').trim();
      jsonArray = JSON.parse(cleanStr);
    } catch (e) {
      console.error("JSON 파싱 에러:", e, rawText);
      return []; // 에러 시 빈 배열 반환하여 UI 크래시 완벽 차단
    }

    const sets = [];
    jsonArray.forEach(q => {
      // AI 누락 대비 안전장치 (undefined 노출 방지)
      const mCat = q.mainCategory || '대분류 없음';
      const sCat = q.subCategory || '중분류 없음';
      const sTitle = q.subTitle || '소제목 없음';
      
      // 기존 UI 구조와 100% 동일하게 렌더링되도록 시각적 태그 조립
      const titleHtml = `📝 Q${q.qNum || '?'}. <span style="color: var(--color-primary);">[${mCat} - ${sCat}]</span> ${sTitle}`;
      const titleText = `📝 Q${q.qNum || '?'}. [${mCat} - ${sCat}] ${sTitle}`;

      // 아코디언 내부 본문 조립 (기존 정규식이 잡아내던 마크다운 아이콘 완벽 재현)
      let bodyText = `🗣️ 면접 질문: ${q.mainQuestion || '내용 없음'}\n\n🎯 출제 의도: ${q.intention || '내용 없음'}`;
      
      // 꼬리 질문이 존재할 경우 하단에 조립
      if (q.tailQuestions && q.tailQuestions.length > 0) {
        bodyText += `\n\n🔗 꼬리 질문:\n`;
        q.tailQuestions.forEach(tail => {
          bodyText += `- ${tail}\n`;
        });
      }

      sets.push({
        title: titleText,
        titleHtml: titleHtml,
        body: bodyText.trim(),
        raw: JSON.stringify(q)
      });
    });

    return sets;
  }
  
  const rawText = isPsMode ? (questionsData.statement_questions_json || '') : (questionsData.record_questions_json || '');
  const questionSets = parseQuestionSets(rawText);
  
  if (questionSets.length === 0) {
    const p = document.createElement('p');
    p.className = 'text-muted';
    p.style.padding = '20px';
    p.textContent = `아직 생성된 ${isPsMode ? '자소서' : '생기부'} 기반 예상 질문이 없습니다.`;
    qList.appendChild(p);
  } else {
    if (CURRENT_ROLE === '관리자') {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-action';
      resetBtn.style.width = '100%';
      resetBtn.style.marginBottom = '15px';
      resetBtn.style.backgroundColor = '#dc3545';
      resetBtn.style.color = '#fff';
      resetBtn.innerHTML = `<i class="fa-solid fa-trash"></i> ${isPsMode ? '자소서' : '생기부'} 예상질문 전체 초기화`;
      resetBtn.onclick = async () => {
        if (!confirm(`정말 해당 학생의 ${isPsMode ? '자소서' : '생기부'} 예상질문을 모두 삭제하시겠습니까?`)) return;
        if (!confirm(`경고: 질문을 삭제하면 재생성 전까지 '미생성' 상태로 되돌아가며, 학생의 답변도 함께 삭제 됩니다. 최종 삭제하시겠습니까?`)) return;
        
        try {
          // 해당 모드의 질문(title) 키값들을 찾아서 answersObj에서 모두 삭제 (학생 답변 싹 다 날림)
          let currentAnswers = {};
          try { currentAnswers = JSON.parse(student.studentAnswers || '{}'); } catch(e){}
          questionSets.forEach(q => {
             delete currentAnswers[q.title];
          });
          const updatedAnswersText = JSON.stringify(currentAnswers);

          const typeStr = isPsMode ? '자소서' : '생기부';
          const res = await ApiClient.post('resetAIQuestions', { studentId: studentLink, type: typeStr, updatedAnswersText: updatedAnswersText });
          if (res.success) {
            alert('성공적으로 초기화되었습니다.');
            document.getElementById('modal-interview-practice').classList.remove('open');
            await loadStudentsData();
          } else {
            alert('초기화 실패: ' + (res.error || '알 수 없는 오류'));
          }
        } catch (e) {
          alert('오류 발생: ' + e.toString());
        }
      };
      qList.appendChild(resetBtn);
    }

    let answersObj = {};
    let originalAnswersObj = {};
    try {
      answersObj = JSON.parse(student.studentAnswers || '{}');
      originalAnswersObj = JSON.parse(student.studentAnswers || '{}');
    } catch (e) {}
    
    let currentSelectedTitle = null;
    const textInput = document.getElementById('interview-answer-textarea');
    
    // 사용자가 입력할 때마다 실시간 UI 갱신 함수
    function updateChangedIndicator() {
      const indicator = document.getElementById('changed-questions-indicator');
      if (!indicator) return;
      const changed = [];
      const unchanged = [];
      questionSets.forEach(q => {
        const orig = (originalAnswersObj[q.title] || '').trim();
        const curr = (answersObj[q.title] || '').trim();
        const shortTitle = q.title.split('.')[0];
        if (curr !== orig) {
          changed.push(shortTitle);
        } else {
          unchanged.push(shortTitle);
        }
      });
      
      const changedStr = changed.length > 0 ? changed.join(' / ') : '없음';
      const unchangedStr = unchanged.length > 0 ? unchanged.join(' / ') : '없음';
      
      indicator.innerHTML = `
        <div style="font-size: 14px; line-height: 1.5; font-weight: bold;">
          <span style="color: var(--color-primary);">💾 답변이 변경된 질문(저장 반영) : </span><span style="color: #ffeb3b;">${changedStr}</span>
        </div>
        <div style="font-size: 14px; line-height: 1.5; color: #ffffff; font-weight: normal;">
          🔒 답변의 변경이 없는 질문(저장 미반영) : ${unchangedStr}
        </div>
      `;
    }

    // 사용자가 입력할 때마다 메모리에 즉시 임시 저장 (탭 전환 시 날아감 방지)
    textInput.oninput = () => {
      if (currentSelectedTitle && CURRENT_ROLE === '학생') {
        answersObj[currentSelectedTitle] = textInput.value;
        updateChangedIndicator();
      }
    };

    questionSets.forEach((set, index) => {
      const btn = document.createElement('button');
      btn.className = 'btn-action btn-secondary';
      btn.style.textAlign = 'left';
      btn.style.justifyContent = 'flex-start';
      btn.style.whiteSpace = 'normal';
      btn.innerHTML = set.titleHtml || set.title;
      btn.onclick = () => {
        currentSelectedTitle = set.title;
        document.getElementById('selected-question-label').innerHTML = set.titleHtml || set.title;
        document.getElementById('modal-question-text').innerHTML = parseMarkdownToHtml(set.body);
        
        textInput.value = answersObj[set.title] || '';
        
        const saveBtn = document.getElementById('btn-save-interview-answer');
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.replaceWith(newSaveBtn);
        
        if (CURRENT_ROLE !== '학생') {
          textInput.readOnly = true;
          textInput.placeholder = "학생이 작성한 답변 내용입니다.";
          newSaveBtn.style.display = 'none';
        } else {
          textInput.readOnly = false;
          textInput.placeholder = "해당 질문에 대한 면접 답변을 작성하십시오... (질문 탭을 이동해도 내용은 임시 유지되지만, 반드시 [답변 저장하기]를 눌러야 최종 서버에 저장됩니다.)";
          newSaveBtn.style.display = 'inline-block';
        }
        
        newSaveBtn.onclick = async () => {
          // 버튼 클릭 시 현재 텍스트박스 내용을 한번 더 확실히 메모리에 동기화
          answersObj[currentSelectedTitle] = textInput.value;
          updateChangedIndicator(); // 마지막 값 동기화
          
          const changed = [];
          const unchanged = [];
          
          questionSets.forEach(q => {
            const orig = (originalAnswersObj[q.title] || '').trim();
            const curr = (answersObj[q.title] || '').trim();
            const shortTitle = q.title.split('.')[0];
            if (curr !== orig) {
              changed.push(shortTitle);
            } else {
              unchanged.push(shortTitle);
            }
          });
          
          const changedStr = changed.length > 0 ? changed.join(' / ') : '없음';
          const unchangedStr = unchanged.length > 0 ? unchanged.join(' / ') : '없음';
          
          if (changed.length === 0) {
            alert('답변 변경 사항이 없어 서버에 저장할 내용이 없습니다.');
            return;
          }
          
          const msg = `[저장 확인]\n- 💾 답변이 변경된 질문(저장 반영) : ${changedStr}\n- 🔒 답변의 변경이 없는 질문(저장 미반영) : ${unchangedStr}\n\n위 변경사항을 서버에 일괄 저장하시겠습니까?`;
          if (!confirm(msg)) return;
          
          try {
            await ApiClient.post('saveStudentAnswers', {
              studentId: studentLink,
              answersText: JSON.stringify(answersObj)
            });
            alert('작성하신 모든 답변 내용이 스프레드시트에 성공적으로 일괄 저장되었습니다.');
            student.studentAnswers = JSON.stringify(answersObj);
            originalAnswersObj = JSON.parse(JSON.stringify(answersObj));
            updateChangedIndicator();
          } catch (e) {
            alert('답변 저장 실패: ' + e.toString());
          }
        };
      };
      qList.appendChild(btn);
    });
    
    // 모달 렌더링 완료 시 최초 1회 상태 표시줄 강제 업데이트 (레이아웃 Shift 방지)
    updateChangedIndicator();
  }
  
  document.getElementById('modal-interview-practice').classList.add('open');
}

/**
 * AI 피드백 생성 실행 (관리자 권한 전용)
 */
async function runAIFeedbackAction() {
  if (!ACTIVE_PS_STUDENT) return;
  if (CURRENT_ROLE !== '관리자' && CURRENT_ROLE !== '교사') {
    alert('AI 도움받기 실행은 교사 또는 관리자 계정만 요청할 수 있습니다.');
    return;
  }
  
  const qNum = document.getElementById('ps-question-selector').value;
  const displayQNum = String(qNum).startsWith('문항') ? String(qNum) : '문항' + qNum;
  if (!confirm(`현재 문항(${displayQNum}번)에 대한 AI 도움받기를 생성하시겠습니까?`)) return;
  const statementText = window.getCurrentPsText ? window.getCurrentPsText(true) : document.getElementById('ps-content-textarea').value;
  const rawVal = window.getCurrentPsText ? window.getCurrentPsText(false).replace(/\[상세분할\]/g, '').trim() : statementText.trim();
  
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(ACTIVE_PS_STUDENT));
  const targetSchool = student ? (student.targetSchool || student.target_school) : null;
  let totalLimit = 0;
  const matchedSchool = window.findSchoolConfig(targetSchool, student.admissionYear);
  if (matchedSchool && matchedSchool.questions) {
    const qData = matchedSchool.questions.find(q => String(q.label) === String(qNum));
    if (qData) {
      if (qData.limit && !isNaN(parseInt(qData.limit))) {
        totalLimit = parseInt(qData.limit);
      } else if (qData.details && qData.details.length > 0) {
        totalLimit = qData.details.reduce((sum, d) => sum + (parseInt(d.limit) || 0), 0);
      }
    }
  }
  
  const currentCount = getCharCount(rawVal, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
  if (totalLimit > 0) {
    if (currentCount < (totalLimit * 0.6)) {
      alert('자소서 내용이 너무 짧거나 비어있습니다.');
      return;
    }
  } else {
    if (!rawVal || rawVal.length < 10) {
      alert('자소서 내용이 너무 짧거나 비어있습니다.');
      return;
    }
  }

  const container = document.getElementById('ai-feedback-container');
  container.innerHTML = '<div style="text-align:center; padding-top:50px;">🚀 Gemini AI가 학생의 자소서 해당 문항을 정밀 분석하는 중입니다. 대략 5~10초 정도 소요되니 잠시만 대기해 주십시오...</div>';
  
  // AI 피드백 생성 전, 학생이 작성 중이던 자소서 내용을 수파베이스에 안전하게 즉시 일괄 저장 (체크리스트와 동일 로직)
  const btnSave = document.getElementById('btn-save-ps');
  if (btnSave) {
    window._isSilentSave = true;
    btnSave.click();
    setTimeout(() => { window._isSilentSave = false; }, 100);
  }
  
  try {
    const res = await ApiClient.post('generateAIFeedback', { 
      studentId: ACTIVE_PS_STUDENT,
      qNum: qNum,
      statementText: statementText
    });
    if (res.success) {
      container.innerHTML = parseMarkdown(res.feedback);
      alert('AI 피드백 생성이 성공적으로 완료되었습니다!');
      // 레이스 컨디션(저장과 생성이 겹쳐 메모리가 꼬이는 현상) 방지
      // 생성이 완료되고 서버 DB에 정상 기록된 즉시 최신 상태를 DB로부터 통째로 다시 긁어오며 AI 탭을 유지합니다.
      if (typeof openPersonalStatementModal === 'function') {
        openPersonalStatementModal(ACTIVE_PS_STUDENT, 'ai', qNum);
      }
    } else {
      throw new Error(res.error);
    }
  } catch (err) {
    container.textContent = '🚨 AI 분석 실행 에러 발생: ' + err.toString();
  }
}

/**
 * 8. 이벤트 핸들러 바인딩
 */
function bindEventHandlers() {
  // ⚙️ 학교 추가 버튼 이벤트
  const btnAddSchool = document.getElementById('btn-add-school');
  if (btnAddSchool) {
    btnAddSchool.onclick = () => {
      syncSchoolInputs();
      if (!window.SCHOOL_QUESTIONS_MAP) window.SCHOOL_QUESTIONS_MAP = [];
      window.SCHOOL_QUESTIONS_MAP.push({ name: '', questions: [] });
      renderSettingsSchools();
    };
  }

  // 3. 업로드 버튼 바인딩
  const uploadBtn = document.getElementById('btn-upload-pdf');
  const uploadInput = document.getElementById('general-pdf-input');
  if (uploadBtn && uploadInput) {
    uploadBtn.onclick = () => {
      if (CURRENT_ROLE === '학생' || CURRENT_ROLE === '게스트') {
        alert('업로드 권한이 없습니다.');
        return;
      }
      uploadInput.click();
    };
    
    uploadInput.onchange = async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      
      const validFiles = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf') && !file.type.startsWith('image/')) {
          alert(`🚨 오류: ${file.name}은(는) 올바른 파일 형식이 아닙니다.`);
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          alert(`🚨 용량 초과: ${file.name}의 크기가 20MB를 초과합니다.`);
          continue;
        }
        validFiles.push(file);
      }
      
      if (validFiles.length === 0) {
        e.target.value = '';
        return;
      }

      showGlobalLoader(`서버로 ${validFiles.length}개의 파일을 전송하는 중입니다...`);
      let successCount = 0;

      for (const file of validFiles) {
        try {
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
          });

          const folderType = 'guide';
          let folderIdStr = '';
          if (folderType === 'guide') {
            folderIdStr = extractDriveId(document.getElementById('settings-drive-guide')?.value || '') || 'admissions';
          }
          
          const res = await ApiClient.post('uploadGeneralPdf', {
            fileName: file.name,
            mimeType: file.type,
            base64Data: 'data:' + file.type + ';base64,' + base64Data, // Data URL 형태로 조립해서 전송
            folderId: folderIdStr
          });
          
          if (res.success) {
            successCount++;
          } else {
            console.error(`${file.name} 업로드 실패:`, res.error);
          }
        } catch (err) {
          console.error(`${file.name} 업로드 에러:`, err);
        }
      }
      
      hideGlobalLoader();
      e.target.value = ''; // 초기화
      
      if (successCount > 0) {
        alert(`${successCount}개의 파일 업로드 완료!`);
        loadPdfFiles(CURRENT_MENU);
      } else {
        alert('업로드에 실패했습니다. 콘솔을 확인해주세요.');
      }
    };
  }

  // [자소서 3중 안전장치] 입력 감지 및 브라우저 종료 방어
  document.getElementById('ps-content-textarea').addEventListener('input', () => { 
    isPsDirty = true; 
  });
  window.addEventListener('beforeunload', (e) => {
    if (isPsDirty) {
      e.preventDefault();
      e.returnValue = ''; // 브라우저 네이티브 경고창 활성화
    }
  });

  // 검색 인풋 연동
  document.getElementById('search-student').addEventListener('input', renderMainTable);
  
  const filterSchool = document.getElementById('filter-target-school');
  if (filterSchool) {
    filterSchool.addEventListener('change', renderMainTable);
  }
  
  // 사이드바 메뉴 클릭 스위칭 연동
  // 설정창 변경사항 추적용 플래그
  window.isSettingsDirty = false;
  document.getElementById('settings-panel').addEventListener('input', () => {
    window.isSettingsDirty = true;
  });

  const menuItems = document.querySelectorAll('.menu-item');
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetMenu = item.getAttribute('data-menu');
      if (CURRENT_MENU === 'settings' && targetMenu !== 'settings' && window.isSettingsDirty) {
        if (!confirm('저장하지 않은 설정(비밀번호, 자소서 문항 등)이 있습니다.\n저장하지 않고 이동하시겠습니까?')) {
          return;
        }
        window.isSettingsDirty = false;
      }

      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      CURRENT_MENU = targetMenu;
      
      const titleMap = {
        dashboard: '초기 화면 (대시보드)',
        info: '학생정보 관리',
        record: '생활기록부 채점 현황',
        ps: '자기소개서 첨삭 이력',
        interview: '과제 및 예상질문 연습',
        guide: '입학요강',
        settings: '시스템 환경 설정',
        'user-guide': '시스템 사용 가이드'
      };
      const subMap = {
        dashboard: '2027 외고·국제고 지원자 합격 현황 대시보드',
        info: '학원생 기본 인적사항 및 연락처 조회',
        record: '생활기록부 점수 160점 만점 대비 채점 상세 (※ 점수 옆의 등급은 3-2국어, 3-2사회, 3-1국어, 3-1사회 성적 순)',
        ps: '자기소개서 🚀최종제출 및 이력 롤백 복원 창',
        interview: 'AI 질문 생성 목록 및 학생 구술 답변 연습 관리',
        guide: '목표 외고·국제고 입학요강 열람',
        settings: '학교 관리, 비밀번호 변경 및 백엔드 연동 통제',
        'user-guide': '역할 및 권한별 시스템 상세 이용 매뉴얼'
      };
      
      if (CURRENT_MENU === 'record') {
        const cTitle = document.getElementById('content-title');
    cTitle.style.display = 'flex';
    cTitle.style.alignItems = 'center';
    cTitle.style.gap = '14px';
    cTitle.innerHTML = `${titleMap[CURRENT_MENU] || '생활기록부 채점 현황'} <span style="font-size: 14px; background-color: rgba(255, 0, 0, 0.15); border: 1px solid #ff4444; color: #ff6666; padding: 4px 12px; border-radius: 20px; font-weight: bold; white-space: nowrap;">🚨 표기 : 국어, 사회에 B 이하가 있는 학생</span>`;
      } else {
        document.getElementById('content-title').textContent = titleMap[CURRENT_MENU] || '초기 화면';
      }
      
      document.getElementById('content-subtitle').textContent = subMap[CURRENT_MENU] || '';
      
      // UI 노출 통제 (설정 패널 활성화 관련)
      const tableContainer = document.querySelector('.table-container');
      const tableControls = document.querySelector('.table-controls');
      const scoreAccordion = document.getElementById('score-accordion');
      const settingsPanel = document.getElementById('settings-panel');
      const userGuidePanel = document.getElementById('user-guide-panel');
      const pdfLibraryPanel = document.getElementById('pdf-library-panel');
      
      if (CURRENT_MENU === 'settings') {
        if (tableContainer) tableContainer.style.display = 'none';
        if (tableControls) tableControls.style.display = 'none';
        if (scoreAccordion) scoreAccordion.classList.remove('open');
        if (userGuidePanel) userGuidePanel.style.display = 'none';
        if (pdfLibraryPanel) pdfLibraryPanel.style.display = 'none';
        if (settingsPanel) {
          settingsPanel.style.display = 'block';
          loadSettingsForm(); // 설정 데이터 로드하여 폼 채우기
        }
      } else if (CURRENT_MENU === 'user-guide') {
        if (tableContainer) tableContainer.style.display = 'none';
        if (tableControls) tableControls.style.display = 'none';
        if (scoreAccordion) scoreAccordion.classList.remove('open');
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (pdfLibraryPanel) pdfLibraryPanel.style.display = 'none';
        if (userGuidePanel) {
          userGuidePanel.style.display = 'block';
          renderUserGuideContent(); // 사용안내 렌더링
        }
      } else if (CURRENT_MENU === 'guide') {
        if (tableContainer) tableContainer.style.display = 'none';
        if (tableControls) tableControls.style.display = 'none';
        if (scoreAccordion) scoreAccordion.classList.remove('open');
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (userGuidePanel) userGuidePanel.style.display = 'none';
        if (pdfLibraryPanel) {
          pdfLibraryPanel.style.display = 'flex';
          loadPdfFiles(CURRENT_MENU); // PDF 파일 목록 불러오기
        }
      } else {
        if (tableContainer) tableContainer.style.display = 'block';
        if (tableControls) tableControls.style.display = 'flex';
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (userGuidePanel) userGuidePanel.style.display = 'none';
        if (pdfLibraryPanel) pdfLibraryPanel.style.display = 'none';
        
        renderMainTable();
      }
      
      const sBanner = document.getElementById('student-warning-banner');
      if (sBanner) {
        if (CURRENT_ROLE === '학생' && CURRENT_MENU === 'ps') {
          sBanner.style.display = 'block';
        } else {
          sBanner.style.display = 'none';
        }
      }
      
      const mainHeaderActions = document.getElementById('main-header-actions');
      if (mainHeaderActions) {
        mainHeaderActions.innerHTML = '';
      }
    });
  });
  
  // 로그인 모달 오픈
  document.getElementById('btn-login-modal').onclick = () => {
    document.getElementById('login-error-msg').style.display = 'none';
    document.getElementById('login-password').value = '';
    document.getElementById('modal-login').classList.add('open');
  };
  // 로그인 패스워드 창 엔터키 연동
  const loginPwInput = document.getElementById('login-password');
  if (loginPwInput) {
    loginPwInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-submit-login').click();
      }
    });
  }
  
  // 로그인 제출
  document.getElementById('btn-submit-login').onclick = async () => {
    const pw = document.getElementById('login-password').value;
    const errorMsgEl = document.getElementById('login-error-msg');
    errorMsgEl.style.display = 'none';

    // 🚨 시스템 부트스트랩 예외처리 (가짜 데이터 제거로 인한 데드락 방지)
    // GAS WebApp URL이 세팅되지 않은 극초기 상태에서, 관리자가 환경설정에 접근할 수 있도록 기본 비번 통과 허용
    if (!GAS_WEBAPP_URL && pw === 'w2027pass!@#') {
      CURRENT_ROLE = '관리자';
      sessionStorage.setItem('user_role', CURRENT_ROLE);
      sessionStorage.setItem('user_pw', pw);
      applyRoleUI(CURRENT_ROLE);
      ACTIVE_ADMIN_PASSWORD = pw;
      document.getElementById('modal-login').classList.remove('open');
      alert('[로컬 긴급모드] 관리자로 임시 진입했습니다.\n최우선적으로 우측 상단 [환경설정]에 들어가서 GAS WebApp URL을 등록하고 저장하세요!');
      return;
    }

    try {
      const authResult = await ApiClient.post('verifyPassword', { password: pw });
      if (authResult.success) {
        CURRENT_ROLE = authResult.role;
        sessionStorage.setItem('user_role', CURRENT_ROLE);
        sessionStorage.setItem('user_pw', pw);
        applyRoleUI(CURRENT_ROLE);
        if (CURRENT_ROLE === '관리자') {
          ACTIVE_ADMIN_PASSWORD = pw; // 관리자 잠금 해제용 패스워드 로컬 캐싱
        }
        document.getElementById('modal-login').classList.remove('open');
        alert(`${CURRENT_ROLE} 계정으로 성공적으로 인증되었습니다.`);
        loadStudentsData(); // 권한 변동에 따라 테이블 다시 렌더링
      } else {
        errorMsgEl.textContent = authResult.error || '비밀번호가 올바르지 않습니다.';
        errorMsgEl.style.display = 'block';
      }
    } catch (err) {
      // 🚨 GAS 통신 에러를 비밀번호 에러로 퉁치지 않고, 명확한 원인 표출
      errorMsgEl.innerHTML = err.message.replace(/\n/g, '<br>');
      errorMsgEl.style.display = 'block';
    }
  };
  
  const refCb = document.getElementById('reg-is-reference');
  if(refCb) {
    refCb.addEventListener('change', (e) => {
      if(e.target.checked) {
        const confirmCheck = confirm("⚠️ 이 체크박스에 체크된 학생은 참고용 학생으로 자소서 작성 및 예상질문 기능 등을 사용할 수 없습니다. 그래도 진행하시겠습니까?");
        if(!confirmCheck) {
          e.target.checked = false;
        }
      }
    });
  }
  
  // 신규 학생 등록 버튼 (사이드바) 로직
  isEditMode = false;
  document.getElementById('btn-open-register').onclick = () => {
    isEditMode = false;
    document.getElementById('register-modal-title').textContent = '신규 학생 등록';
    document.getElementById('btn-submit-register').textContent = '등록 완료';
  const deleteGroup = document.getElementById('delete-btn-group');
  if (deleteGroup) deleteGroup.style.display = 'none';

    
    // 초기화 및 readonly 해제
    ['center','name','school','target-school','parent-phone','student-phone','teacher'].forEach(id => {
      const el = document.getElementById('reg-' + id);
      if (el) el.value = '';
    });
    const refCb = document.getElementById('reg-is-reference');
    if(refCb) refCb.checked = false;
    const phoneInput = document.getElementById('reg-student-phone');
    phoneInput.removeAttribute('readonly');
    phoneInput.style.backgroundColor = '';
    
    document.getElementById('modal-register').classList.add('open');
  };
  
  document.getElementById('btn-submit-register').onclick = async () => {
    const teacherVal = document.getElementById('reg-teacher') ? document.getElementById('reg-teacher').value : '';
    const studentData = {
      center: document.getElementById('reg-center').value,
      admissionYear: document.getElementById('reg-admission-year').value,
      name: document.getElementById('reg-name').value,
      school: document.getElementById('reg-school').value,
      targetSchool: document.getElementById('reg-target-school').value,
      parentPhone: document.getElementById('reg-parent-phone').value,
      studentPhone: document.getElementById('reg-student-phone').value,
      teacher: teacherVal,
      mathTeacher: teacherVal,
      isReference: document.getElementById('reg-is-reference') ? document.getElementById('reg-is-reference').checked : false
    };
    
    if (!studentData.center || !studentData.name || !studentData.school || !studentData.targetSchool || !studentData.parentPhone) {
      alert('센터명, 학생명, 현재 학교, 지원 예정 학교, 학부모 연락처는 필수 기재 사항입니다.');
      return;
    }
    
    try {
      if (isEditMode) {
        // 기존 학생 수정 로직 (mock/연동)
        await ApiClient.post('updateStudent', { studentData, originalLink: ACTIVE_EDIT_STUDENT_LINK });
        alert('학생 정보가 성공적으로 수정되었습니다.');
      } else {
        await ApiClient.post('registerStudent', { studentData });
        alert('신규 학생이 등록 완료되었으며 데이터베이스가 자동 세팅되었습니다.');
      }
      document.getElementById('modal-register').classList.remove('open');
      loadStudentsData();
    } catch (err) {
      alert('저장 에러: ' + err.toString());
    }
  };
  
  // 모달 닫기 공통
  const overlays = document.querySelectorAll('.modal-overlay');
  overlays.forEach(overlay => {
    const container = overlay.querySelector('.modal-container');
    overlay.addEventListener('click', (e) => {
      // 미인증 상태(로그인 전)일 때는 로그인 모달 오버레이 클릭 시 닫힘 무시
      if (!CURRENT_ROLE && overlay.id === 'modal-login') return;
      
      // 바깥 클릭 시 닫히지 않도록 방지 (원장님 요청)
    });
  });
  
  
  document.getElementById('btn-close-register-modal').onclick = () => { if(confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) { document.getElementById('modal-register').classList.remove('open'); } }
  document.getElementById('btn-cancel-register').onclick = () => { if(confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) { document.getElementById('modal-register').classList.remove('open'); } }
  document.getElementById('btn-close-ps-modal').onclick = () => { if(!isPsDirty || confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) { isPsDirty = false; document.getElementById('modal-ps-editor').classList.remove('open'); } }
  document.getElementById('btn-close-ps-editor-modal').onclick = () => { if(!isPsDirty || confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) { isPsDirty = false; document.getElementById('modal-ps-editor').classList.remove('open'); } }
      document.getElementById('btn-close-ps-editor-modal').onclick = () => { if(!isPsDirty || confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) { isPsDirty = false; document.getElementById('modal-ps-editor').classList.remove('open'); } }
  document.getElementById('btn-close-interview-modal').onclick = () => { if(confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) { document.getElementById('modal-interview-practice').classList.remove('open'); } }
  document.getElementById('btn-close-interview-practice-modal').onclick = () => {
    if (CURRENT_ROLE !== '학생') {
      document.getElementById('modal-interview-practice').classList.remove('open');
      return;
    }
    if (confirm('저장하지 않은 내용은 모두 사라집니다. 정말 창을 닫으시겠습니까?')) {
      document.getElementById('modal-interview-practice').classList.remove('open');
    }
  };
  document.getElementById('btn-close-score-details-modal').onclick = () => { document.getElementById('modal-score-details').classList.remove('open'); }
  document.getElementById('btn-close-score-details-bottom').onclick = () => { document.getElementById('modal-score-details').classList.remove('open'); }
  const closePdfModal = () => {
    const modal = document.getElementById('modal-pdf-preview');
    const container = document.getElementById('pdf-preview-container');
    if (modal) modal.classList.remove('open');
    if (container) container.innerHTML = '';
  };
  const closePdfTop = document.getElementById('btn-close-pdf-preview-modal');
  const closePdfBtm = document.getElementById('btn-close-pdf-preview-bottom');
  if (closePdfTop) closePdfTop.onclick = closePdfModal;
  if (closePdfBtm) closePdfBtm.onclick = closePdfModal;
  
  // 자소서 문항 드롭다운 연동
  document.getElementById('ps-question-selector').onchange = (e) => {
    bindPersonalStatementToSelector(e.target.value);
  };



  // 타임머신 드롭다운 변경 연동
  const historySelector = document.getElementById('ps-history-selector');
  if (historySelector) {
    historySelector.onchange = (e) => {
      if (e.target.value) {
        if (confirm('선택하신 과거 버전으로 자소서 내용을 되돌리시겠습니까? (저장하지 않으면 원본이 유지됩니다.)')) {
          document.getElementById('ps-content-textarea').value = e.target.value;
          const targetSchool = document.getElementById('ps-school-name').textContent.replace('지원 학교: ', '');
          document.getElementById('ps-char-count').textContent = getCharCount(e.target.value, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
          
          // 동적 분할 텍스트 에어리어가 켜져있다면 분할해서 복원
          const container = document.getElementById('ps-dynamic-details-container');
          if (container && container.style.display !== 'none') {
             const tas = container.querySelectorAll('.dynamic-ps-textarea');
             let parts = e.target.value.includes('[상세분할]') ? e.target.value.split('[상세분할]') : [e.target.value];
             tas.forEach((ta, idx) => {
                 ta.value = parts[idx] !== undefined ? parts[idx].trim() : '';
                 if (ta.oninput) ta.oninput();
             });
          }

          const qNum = document.getElementById('ps-question-selector').value;
          const hData = window.PS_CURRENT_HISTORY;
          if (hData && hData.current) {
            const curr = hData.current.find(c => String(c.qNum) == String(qNum));
            if (curr) {
              curr.text = e.target.value;
              isPsDirty = true;
            }
          }
        } else {
          e.target.value = '';
        }
      }
    };
  }
  
  // 자소서 모달 내 수기/AI 탭 전환
  document.getElementById('tab-btn-manual-feedback').onclick = () => switchTab('manual');
  document.getElementById('tab-btn-ai-feedback').onclick = () => switchTab('ai');
  
    // 글자 수 실시간 카운팅 및 로컬 자동 기억(백업)
  document.getElementById('ps-content-textarea').oninput = (e) => {
    const uiTargetSchool = document.getElementById('ps-school-name').textContent.replace('지원 학교: ', '');
    const targetSchool = uiTargetSchool;
    document.getElementById('ps-char-count').textContent = getCharCount(e.target.value, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
    
    // 로컬 자동 기억 (자소서)
    const qNum = document.getElementById('ps-question-selector').value;
    const [tSchool, tQNum] = qNum.includes('|') ? qNum.split('|') : [uiTargetSchool, qNum];
    const hData = window.PS_CURRENT_HISTORY;
    if (hData && hData.current) {
      const curr = hData.current.find(c => window.normalizeQNum(c.qNum) === window.normalizeQNum(tQNum) && (c.version_label === tSchool || (!c.version_label && tSchool === uiTargetSchool)));
      if (curr) {
        curr.text = e.target.value;
        isPsDirty = true;
      }
    }
  };

  document.getElementById('manual-feedback-textarea').oninput = (e) => {
    // 로컬 자동 기억 (피드백)
    const uiTargetSchool = document.getElementById('ps-school-name').textContent.replace('지원 학교: ', '');
    const qNum = document.getElementById('ps-question-selector').value;
    const [tSchool, tQNum] = qNum.includes('|') ? qNum.split('|') : [uiTargetSchool, qNum];
    const hData = window.PS_CURRENT_HISTORY;
    if (hData && hData.current) {
      const curr = hData.current.find(c => window.normalizeQNum(c.qNum) === window.normalizeQNum(tQNum) && (c.version_label === tSchool || (!c.version_label && tSchool === uiTargetSchool)));
      if (curr) {
        curr.feedback = e.target.value;
        isPsDirty = true;
      }
    }
  };
  
    // 자소서 및 피드백 실시간 저장 버튼 연동 (Dirty Check 보완 및 일괄 저장)
  document.getElementById('btn-save-ps').onclick = async () => {
    if (!ACTIVE_PS_STUDENT) return;
    
    const hData = window.PS_CURRENT_HISTORY;
    const origData = window.PS_ORIGINAL_HISTORY_CURRENT;
    if (!hData || !hData.current || !origData) return;

    // 현재 포커스된 창의 최신 내용도 확실하게 한 번 더 hData에 동기화
    const qNum = document.getElementById('ps-question-selector').value;
    const uiTargetSchool = document.getElementById('ps-school-name').textContent.replace('지원 학교: ', '');
    const [tSchool, tQNum] = qNum.includes('|') ? qNum.split('|') : [uiTargetSchool, qNum];
    
    const currActive = hData.current.find(c => window.normalizeQNum(c.qNum) === window.normalizeQNum(tQNum) && (c.version_label === tSchool || (!c.version_label && tSchool === uiTargetSchool)));
    if (currActive) {
      currActive.text = window.getCurrentPsText ? window.getCurrentPsText(false) : document.getElementById('ps-content-textarea').value;
      currActive.feedback = document.getElementById('manual-feedback-textarea').value;
    }
    
    const contents = [];
    let reportMsg = "다음 내용으로 전체 저장이 진행됩니다.\n\n";
    let validSaveCount = 0;
    const qSelector = document.getElementById('ps-question-selector');
    
    // 저장 보고서를 정렬하기 위한 임시 배열
    const reportItems = [];
    
    // 모든 문항을 순회하며 원본과 달라진 부분만 추출 (일괄 저장)
    hData.current.forEach(curr => {
      const orig = origData.find(o => o.qNum === curr.qNum && o.version_label === curr.version_label);
      const oldPs = orig ? orig.text : '';
      const oldFb = orig ? orig.feedback : '';
      
      let displayName = curr.qNum;
      let isVisibleInDropdown = false;
      
      if (qSelector) {
        const compositeKey = curr.version_label ? (curr.version_label + '|' + curr.qNum) : (uiTargetSchool + '|' + curr.qNum);
        const matchedOpt = Array.from(qSelector.options).find(o => o.value === compositeKey);
        if (matchedOpt) {
          displayName = matchedOpt.textContent.trim();
          isVisibleInDropdown = true;
        }
      }
      
      const isChanged = (CURRENT_ROLE === '학생') ? (curr.text !== oldPs) : (curr.feedback !== oldFb);
      const isEmpty = (CURRENT_ROLE === '학생') ? (curr.text.trim() === '') : (curr.feedback.trim() === '');
      
      // 스텔스 차단 방어벽: 드롭다운 화면에 없는 유령 데이터이면서, 내용 변경조차 없다면 팝업창에서 완벽히 숨김
      if (!isVisibleInDropdown && !isChanged) return;
      
      let lineStr = "";
      
      if (CURRENT_ROLE === '학생') {
        if (isChanged && !isEmpty) {
          lineStr = `✅ ${displayName} : 내용 수정됨 (저장 대기)\n`;
          contents.push({ qNum: curr.qNum, text: curr.text, type: '자소서', version_label: curr.version_label });
          validSaveCount++;
        } else if (!isChanged && !isEmpty) {
          lineStr = `➖ ${displayName} : 변경 없음 (기존 유지)\n`;
        } else if (!isChanged && isEmpty) {
          lineStr = `❌ ${displayName} : 빈 칸 (저장 불가)\n`;
        } else if (isChanged && isEmpty) {
          lineStr = `❌ ${displayName} : 내용이 빈 칸으로 수정됨 (저장 불가)\n`;
        }
      } else {
        if (curr.feedback !== oldFb) {
          lineStr = `✅ ${displayName} : 피드백 내용 수정됨 (저장 대기)\n`;
          contents.push({ qNum: curr.qNum, text: curr.feedback, type: '피드백', version_label: curr.version_label });
          validSaveCount++;
        } else {
          lineStr = `➖ ${displayName} : 피드백 변경 없음 (기존 유지)\n`;
        }
      }
      
      if (lineStr) {
        reportItems.push({ curr, lineStr, displayName });
      }
    });

    // 팝업창 출력 내용 정렬 (드롭다운과 완벽히 동일한 논리적 정렬)
    reportItems.sort((a, b) => {
      const aIsOld = a.displayName.includes('(구)');
      const bIsOld = b.displayName.includes('(구)');
      
      // 1. (구) 항목은 무조건 뒤로
      if (aIsOld !== bIsOld) return aIsOld ? 1 : -1;
      
      // 2. 버전 라벨(학교명)별로 그룹핑
      const labelA = (a.curr.version_label || '').trim();
      const labelB = (b.curr.version_label || '').trim();
      if (labelA !== labelB) return labelA.localeCompare(labelB);
      
      // 3. 문항 번호 숫자 단위 정렬 (예: 1-2, 2-1 순서 보장)
      const parseNum = (str) => {
        const m = String(str).match(/(\d+)(?:-(\d+))?/);
        if (!m) return [999, 999];
        return [parseInt(m[1]), parseInt(m[2] || 0)];
      };
      const numA = parseNum(a.curr.qNum);
      const numB = parseNum(b.curr.qNum);
      
      if (numA[0] !== numB[0]) return numA[0] - numB[0];
      return numA[1] - numB[1];
    });

    // 정렬된 결과를 최종 문자열에 합치기
    reportItems.forEach(item => {
      reportMsg += item.lineStr;
    });
    
    let totalTextLength = 0;
    hData.current.forEach(curr => {
      if (curr.text) {
        totalTextLength += curr.text.replace(/\s+/g, '').length;
      }
    });
    const isAllEmpty = (totalTextLength === 0);
    
    const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(ACTIVE_PS_STUDENT));
    const currentStatus = student ? student.cover_letter_status : '';
    const isStatusMismatch = (isAllEmpty && currentStatus !== '작성전') || (!isAllEmpty && currentStatus === '작성전');

    if (validSaveCount === 0 && !isStatusMismatch) {
      if (!window._isSilentSave) {
        alert('⚠️ 수정한 문항이 없거나 모두 빈 칸이어서 저장할 항목이 없습니다.');
      }
      return;
    }

    if (!window._isSilentSave && validSaveCount > 0) {
      if (!confirm(reportMsg + "\n위 상태로 최종 저장하시겠습니까?")) {
        return;
      }
    }

    const writerName = CURRENT_ROLE === '학생' ? '학생' : '선생님';
    
    try {
      const res = await ApiClient.post('savePersonalStatement', {
        studentId: ACTIVE_PS_STUDENT,
        contents: contents,
        writer: writerName,
        isAllEmpty: isAllEmpty
      });
      if (!res.success) throw new Error(res.error || '알 수 없는 서버 에러');
      
      alert('전체 문항의 저장이 성공적으로 완료되었습니다.');
      
      // 저장 성공 시, 현재 상태를 다시 원본으로 갱신
      window.PS_ORIGINAL_HISTORY_CURRENT = JSON.parse(JSON.stringify(hData.current));
      isPsDirty = false;
      
      // 이력 갱신
      const reqPw = sessionStorage.getItem('user_pw') || '';
      const historyData = await ApiClient.post('getPersonalStatementHistory', {
        studentId: ACTIVE_PS_STUDENT,
        clientRole: CURRENT_ROLE,
        authPw: reqPw
      });
      // DB 저장 직후 동기화 지연(Race Condition)이나 서버 패딩 누락으로 인해 화면이 휘발되는 현상을 막기 위해
      // 방금 우리가 완벽하게 세팅하여 서버로 보낸 '현재 로컬 데이터'를 무조건 100% 신뢰하고 유지합니다.
      historyData.current = JSON.parse(JSON.stringify(hData.current));
      window.PS_CURRENT_HISTORY = historyData;
      bindPersonalStatementToSelector(qNum);
      
    } catch (err) {
      alert('저장 실패: ' + err.toString());
    }
  };
  
  // PDF 업로드 파일 인풋 체인지 리스너 바인딩
  const pdfInput = document.getElementById('student-record-pdf-input');
  if (pdfInput) {
    pdfInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !PDF_TARGET_STUDENT) return;
      
      if (!validatePdfFile(file)) {
        e.target.value = ''; // 초기화
        return;
      }
      
      try {
        alert('생기부 PDF 업로드를 시작합니다. 잠시만 기다려주십시오...');
        const res = await ApiClient.post('uploadStudentRecordPdf', {
          studentId: PDF_TARGET_STUDENT,
          fileObject: file,
          fileName: file.name
        });
        if (res.success) {
          alert('생기부 PDF가 성공적으로 구글 드라이브에 업로드 되었습니다. (수동으로 [AI 채점] 또는 [재채점] 버튼을 눌러야 분석이 시작됩니다)');
          loadStudentsData();
        } else {
          throw new Error(res.error);
        }
      } catch (err) {
        alert('PDF 업로드 실패: ' + err.toString());
      }
      // FileReader 코드는 더 이상 필요 없음
    });
  }

  // AI 피드백 및 초기화 버튼 연동
  const genAIFeedbackBtn = document.getElementById('btn-generate-ai-feedback');
  if (genAIFeedbackBtn) {
    genAIFeedbackBtn.onclick = async () => {
      await runAIFeedbackAction();
    };
  }

  const resetChecklistBtn = document.getElementById('btn-reset-ai-checklist');
  if (resetChecklistBtn) {
    resetChecklistBtn.onclick = async () => {
      if (!ACTIVE_PS_STUDENT) return;
      if (!confirm('현재 문항의 AI 체크리스트를 초기화(삭제) 하시겠습니까?')) return;
      const qNum = document.getElementById('ps-question-selector').value;
      const typeStr = '문항[' + qNum + ']_체크리스트';
      const res = await ApiClient.post('resetAIFeedback', { studentId: ACTIVE_PS_STUDENT, typeStr });
      if (res.success) {
         document.getElementById('ai-checklist-container').innerHTML = '<div style="color: var(--text-muted); text-align: center; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.6; word-break: keep-all; padding: 10px;">🚫 기재하면 절대 안되는 사항이나<br>질문의 핵심요점과 어울리지 않는지 등을 체크합니다.<br><br>📝 적어도 자소서 초안이 입력되어야만,<br>선생님들이 확인하여 작성할 수 있습니다.</div>';
         alert('초기화되었습니다.');
         if (typeof openPersonalStatementModal === 'function') {
           openPersonalStatementModal(ACTIVE_PS_STUDENT, 'manual', qNum);
         }
      } else {
         alert('초기화 실패: ' + res.error);
      }
    };
  }

  const resetFeedbackBtn = document.getElementById('btn-reset-ai-feedback');
  if (resetFeedbackBtn) {
    resetFeedbackBtn.onclick = async () => {
      if (!ACTIVE_PS_STUDENT) return;
      if (!confirm('현재 문항의 AI 피드백을 초기화(삭제) 하시겠습니까?')) return;
      const qNum = document.getElementById('ps-question-selector').value;
      const typeStr = '문항[' + qNum + ']_도움받기';
      const res = await ApiClient.post('resetAIFeedback', { studentId: ACTIVE_PS_STUDENT, typeStr });
      if (res.success) {
         document.getElementById('ai-feedback-container').innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">[AI 피드백 로드 대기 중...]</div>';
         alert('초기화되었습니다.');
         if (typeof openPersonalStatementModal === 'function') {
           openPersonalStatementModal(ACTIVE_PS_STUDENT, 'ai', qNum);
         }
      } else {
         alert('초기화 실패: ' + res.error);
      }
    };
  }



  // 설정 개별 저장 버튼 연동 (4개 구역 모두 동일하게 전체 DOM 상태를 저장)
  const executeSaveSettings = async () => {
    if (CURRENT_ROLE !== '관리자') {
      alert('설정 수정 권한은 오직 관리자에게만 있습니다.');
      return;
    }
      
      const basic = {
        '교사': document.getElementById('settings-pw-teacher').value,
        '관리자': document.getElementById('settings-pw-admin').value,
        'GeminiKey': document.getElementById('settings-gemini-key').value,
        'centers': document.getElementById('settings-centers-list').value
      };
      
      
      
      let hasValidationError = false;
      const schools = [];
      const schoolBlocks = document.querySelectorAll('.school-setting-block');
      schoolBlocks.forEach(block => {
        const sName = block.querySelector('.school-name-input').value.trim();
        const sYearInput = block.querySelector('.school-year-input');
        const sYear = sYearInput ? sYearInput.value.trim() : '';
        const includeSpaces = block.querySelector('.school-include-spaces').checked;
        if (sName) {
          const qItems = block.querySelectorAll('.q-item');
          const questions = [];
          qItems.forEach(qItem => {
             const label = qItem.querySelector('.q-label').value.trim();
             const content = qItem.querySelector('.q-content').value.trim();
             const limit = qItem.querySelector('.q-limit').value.trim();
             
             if (!label || !content) {
               hasValidationError = true;
             }
             
             if (label && content) {
               const details = [];
              const detailItems = qItem.querySelectorAll('.detail-item');
              detailItems.forEach(dItem => {
                const dTitle = dItem.querySelector('.detail-title') ? dItem.querySelector('.detail-title').value.trim() : '';
                const dLimit = dItem.querySelector('.detail-limit') ? dItem.querySelector('.detail-limit').value.trim() : '';
                details.push({ title: dTitle, limit: dLimit });
              });
              questions.push({ label, content, limit, details });
             }
          });
          schools.push({ name: sName, admissionYear: sYear, includeSpaces, questions });
        }
      });
      
      if (hasValidationError) {
        alert('항목명 또는 문항 내용이 비어있는 문항이 있습니다. 확인 후 다시 저장해주세요.');
        return;
      }
      
      const settingsData = { basic, schools };
      
      try {
        const res = await ApiClient.post('saveSettings', { settingsData });
        if (res.success) {
          alert('시스템 설정이 성공적으로 저장되었습니다.');
          window.isSettingsDirty = false;
          ACTIVE_ADMIN_PASSWORD = basic['관리자'];
          sessionStorage.setItem('user_pw', ACTIVE_ADMIN_PASSWORD);
          
          window.SCHOOL_QUESTIONS_MAP = schools;
          window.targetSchoolsList = Array.from(new Set(schools.map(s => s.name)));
          updateTargetSchoolDropdowns(window.targetSchoolsList);
          renderSettingsSchools();
        } else {
          alert('저장 실패: ' + res.error);
        }
      } catch (e) {
        alert('통신 오류: ' + e.toString());
      }
  };

  const btnPw = document.getElementById('btn-save-settings-pw');
  const btnApi = document.getElementById('btn-save-settings-api');
  const btnSchool = document.getElementById('btn-save-settings-school');
  const btnDrive = document.getElementById('btn-save-settings-drive');
  const btnCenters = document.getElementById('btn-save-settings-centers');
  if (btnPw) btnPw.onclick = executeSaveSettings;
  if (btnApi) btnApi.onclick = executeSaveSettings;
  if (btnSchool) btnSchool.onclick = executeSaveSettings;
  if (btnDrive) btnDrive.onclick = executeSaveSettings;
  if (btnCenters) btnCenters.onclick = executeSaveSettings;
  
  // 최종 제출하기 (Lock) 버튼 연동
  document.getElementById('btn-submit-ps-final').onclick = async () => {
    if (!ACTIVE_PS_STUDENT) return;
    
    // 💡 작성 안 된 문항 검증 로직 시작
    const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(ACTIVE_PS_STUDENT));
    const schoolMap = window.SCHOOL_QUESTIONS_MAP || [];
    const matchedSchool = window.findSchoolConfig(student.targetSchool, student.admissionYear);
    
    if (!matchedSchool || !matchedSchool.questions || matchedSchool.questions.length === 0) {
      alert('🚨 학교 문항이 설정되지 않았습니다. 제출할 수 없습니다.');
      return;
    }

    const currentQNum = document.getElementById('ps-question-selector').value || '';
    const currentTextAreaVal = window.getCurrentPsText ? window.getCurrentPsText(false) : document.getElementById('ps-content-textarea').value;
    const hData = window.PS_CURRENT_HISTORY || { current: [] };
    
    let unwrittenQuestionLabel = null;
    for (const q of matchedSchool.questions) {
      const label = q.label.trim();
      let qText = '';
      if (label === currentQNum) {
        qText = currentTextAreaVal;
      } else {
        const savedData = hData.current.find(c => String(c.qNum) === label);
        qText = savedData ? (savedData.text || '').trim() : '';
      }
      if (qText.replace(/\[상세분할\]/g, '').trim() === '') {
        unwrittenQuestionLabel = label;
        break;
      }
    }
    
    if (unwrittenQuestionLabel) {
      alert(`🚨 제출 거부: [${unwrittenQuestionLabel}] 내용이 작성되지 않았습니다. 모든 문항을 작성해야 최종 제출이 가능합니다.`);
      return;
    }
    // 💡 작성 안 된 문항 검증 로직 끝

    const msg1 = "🚨 [1차 경고] 자소서의 ⚠️'모든 문항'⚠️이 한 번에 최종본으로 제출됩니다. 제출 완료 후에는 어떤 문항도 더 이상 수정할 수 없으며, 영구적으로 잠깁니다. 진행하시겠습니까?";
    if (!confirm(msg1)) return;
    
    const msg2 = "🚨 [최종 경고] 정말로 자소서의 ⚠️'모든 문항'⚠️을 작성 및 수정이 불가능한 '최종본'으로 일괄 제출하는 것이 확실합니까?";
    if (!confirm(msg2)) return;
    
    try {
      await ApiClient.post('submitPersonalStatement', { studentId: ACTIVE_PS_STUDENT });
      alert('성공적으로 최종 제출 처리되어 자기소개서 편집창이 잠겼습니다.');
      document.getElementById('modal-ps-editor').classList.remove('open');
      loadStudentsData();
    } catch (err) {
      alert('최종 제출 실패: ' + err.toString());
    }
  };

  // AI 챗봇 토글 이벤트
  const chatbotToggle = document.getElementById('btn-ai-chatbot-toggle');
  const chatbotDrawer = document.getElementById('ai-chatbot-drawer');
  const closeChatbot = document.getElementById('btn-close-chatbot');
  const sendChatbotBtn = document.getElementById('btn-send-chatbot-msg');
  const inputChatbot = document.getElementById('input-chatbot-msg');
  
  if (chatbotToggle && chatbotDrawer) {
    chatbotToggle.onclick = () => {
      chatbotDrawer.classList.toggle('open');
    };
  }
  if (closeChatbot && chatbotDrawer) {
    closeChatbot.onclick = () => {
      chatbotDrawer.classList.remove('open');
    };
  }
  if (sendChatbotBtn) {
    sendChatbotBtn.onclick = () => {
      sendChatbotMessage();
    };
  }
  if (inputChatbot) {
    inputChatbot.onkeydown = (e) => {
      if (e.key === 'Enter') {
        sendChatbotMessage();
      }
    };
  }
}

/**
 * 설정 화면 데이터 불러오기 및 바인딩
 */
async function loadSettingsForm() {
  try {
    const res = await ApiClient.post('getSettings');
    // ApiClient가 resJson.data를 자동으로 벗겨서 반환하므로, res는 { basic, schools } 객체임
    const basic = res.basic || {};
    const schools = res.schools || [];
    
    document.getElementById('settings-pw-teacher').value = basic['교사'] || '';
    document.getElementById('settings-pw-admin').value = basic['관리자'] || '';
    document.getElementById('settings-gemini-key').value = basic['GeminiKey'] || '';
    
    
    document.getElementById('settings-centers-list').value = basic.centers || '';
    let centersArray = (basic.centers || '').split(',').map(s => s.trim()).filter(s => s);
    if (centersArray.length === 0) centersArray = ['대치본원', '서초본원'];
    SETTINGS_CENTERS = centersArray;
    updateCenterDropdowns();
    
    window.SCHOOL_QUESTIONS_MAP = schools;
    if (schools.length === 0) {
      window.SCHOOL_QUESTIONS_MAP = [
        { name: '세종국제고', includeSpaces: true, questions: [
          { label: '문항 1', content: '자기주도학습과정(배움과 성장) 및 지원동기와 진로계획을 기술하시오.', limit: '1500' },
          { label: '문항 2', content: '핵심인성역량(배려, 나눔, 협력, 타인존중, 규칙준수 등) 관련 활동 경험을 기술하시오.', limit: '500' }
        ] },
        { name: '대전외고', includeSpaces: true, questions: [
          { label: '문항 1', content: '자기주도학습영역 및 지원동기와 진로계획을 기술하시오.', limit: '1200' },
          { label: '문항 2', content: '인성영역 활동 경험과 이를 통해 배우고 느낀 점을 기술하시오.', limit: '300' }
        ] },
        { name: '충남외고', includeSpaces: true, questions: [
          { label: '문항 1', content: '자기주도학습과정 및 지원동기와 진로계획을 기술하시오.', limit: '1200' },
          { label: '문항 2', content: '인성영역 활동 실적과 이를 통해 배우고 느낀 점을 기술하시오.', limit: '300' }
        ] },
        { name: '경기외고', includeSpaces: true, questions: [
          { label: '문항 1', content: '자기주도학습과정 및 지원동기와 진로계획을 기술하시오.', limit: '1200' },
          { label: '문항 2', content: '인성영역(봉사, 협력, 배려 등) 활동 경험을 기술하시오.', limit: '300' }
        ] }
      ];
    }
    window.targetSchoolsList = Array.from(new Set(window.SCHOOL_QUESTIONS_MAP.map(s => s.name)));
    
    renderSettingsSchools();

    if (basic.common_assignments) {
      try {
        SETTINGS_COMMON_ASSIGNMENTS = JSON.parse(basic.common_assignments);
      } catch(e) {
        SETTINGS_COMMON_ASSIGNMENTS = [];
      }
    } else {
      SETTINGS_COMMON_ASSIGNMENTS = [];
    }
    renderSettingsAssignments();
    
    // 드라이브 폴더 ID 바인딩
    
    // 드롭다운 업데이트
    updateTargetSchoolDropdowns(window.targetSchoolsList);
  } catch (e) {
    console.error('설정 로드 실패', e);
    // 통신 실패 시 화면 렌더링 붕괴를 막기 위한 기본값 할당
    window.SCHOOL_QUESTIONS_MAP = [
      { name: '세종국제고', includeSpaces: true, questions: [
        { label: '문항 1', content: '자기주도학습과정(배움과 성장) 및 지원동기와 진로계획을 기술하시오.', limit: '1500' },
        { label: '문항 2', content: '핵심인성역량(배려, 나눔, 협력, 타인존중, 규칙준수 등) 관련 활동 경험을 기술하시오.', limit: '500' }
      ] },
      { name: '대전외고', includeSpaces: true, questions: [
        { label: '문항 1', content: '자기주도학습영역 및 지원동기와 진로계획을 기술하시오.', limit: '1200' },
        { label: '문항 2', content: '인성영역 활동 경험과 이를 통해 배우고 느낀 점을 기술하시오.', limit: '300' }
      ] },
      { name: '충남외고', includeSpaces: true, questions: [
        { label: '문항 1', content: '자기주도학습과정 및 지원동기와 진로계획을 기술하시오.', limit: '1200' },
        { label: '문항 2', content: '인성영역 활동 실적과 이를 통해 배우고 느낀 점을 기술하시오.', limit: '300' }
      ] },
      { name: '경기외고', includeSpaces: true, questions: [
        { label: '문항 1', content: '자기주도학습과정 및 지원동기와 진로계획을 기술하시오.', limit: '1200' },
        { label: '문항 2', content: '인성영역(봉사, 협력, 배려 등) 활동 경험을 기술하시오.', limit: '300' }
      ] }
    ];
    window.targetSchoolsList = Array.from(new Set(window.SCHOOL_QUESTIONS_MAP.map(s => s.name)));
    renderSettingsSchools();
    updateTargetSchoolDropdowns(window.targetSchoolsList);
  }
}

// 현재 화면의 폼 값을 메모리로 동기화 (텍스트 증발 차단용)
function syncSchoolInputs() {
  if (!window.SCHOOL_QUESTIONS_MAP) return;
  const blocks = document.querySelectorAll('.school-setting-block');
  if (blocks.length !== window.SCHOOL_QUESTIONS_MAP.length) return;
  
  blocks.forEach((block, sIndex) => {
    const nameInput = block.querySelector('.school-name-input');
    const includeSpacesCheck = block.querySelector('.school-include-spaces');
    if (nameInput) window.SCHOOL_QUESTIONS_MAP[sIndex].name = nameInput.value;
    if (includeSpacesCheck) window.SCHOOL_QUESTIONS_MAP[sIndex].includeSpaces = includeSpacesCheck.checked;
    
    const qItems = block.querySelectorAll('.q-item');
    qItems.forEach((qItem, qIndex) => {
      const labelIn = qItem.querySelector('.q-label');
      const contentIn = qItem.querySelector('.q-content');
      const limitIn = qItem.querySelector('.q-limit');
      if (labelIn) window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].label = labelIn.value;
      if (contentIn) window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].content = contentIn.value;
      if (limitIn) window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].limit = limitIn.value;
      
      const detailItems = qItem.querySelectorAll('.detail-item');
      window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].details = [];
      detailItems.forEach((dItem) => {
        const dTitle = dItem.querySelector('.detail-title');
        const dLimit = dItem.querySelector('.detail-limit');
        window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].details.push({
          title: dTitle ? dTitle.value : '',
          limit: dLimit ? dLimit.value : ''
        });
      });
    });
  });
}

// ⚙️ 동적 대상 학교 렌더링 함수
function renderSettingsSchools() {
  
  const listEl = document.getElementById('settings-school-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  listEl.style.display = 'block';

  // [학년도 필터 UI 추가]
  const allYears = Array.from(new Set(window.SCHOOL_QUESTIONS_MAP.map(s => s.admissionYear || '미지정'))).sort((a,b) => b.localeCompare(a));
  if (!window.currentYearFilter && allYears.length > 0) {
    window.currentYearFilter = new Set([allYears[0]]);
  } else if (!window.currentYearFilter) {
    window.currentYearFilter = new Set();
  }

  if (allYears.length > 0) {
    const filterDiv = document.createElement('div');
    filterDiv.style.cssText = "margin-bottom: 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px; display:flex; gap: 15px; align-items:center; flex-wrap:wrap;";
    let filterHtml = '<strong style="color:var(--text-muted);"><i class="fa-solid fa-filter"></i> 학년도 필터:</strong>';
    allYears.forEach(y => {
       const checked = window.currentYearFilter.has(y) ? 'checked' : '';
       filterHtml += `<label style="cursor:pointer; display:flex; align-items:center; gap:5px; color:#fff; font-size:14px;"><input type="radio" name="school-year-filter" class="year-filter-cb" value="${y}" ${checked}> ${y === '미지정' ? '미지정' : y + '학년도'}</label>`;
    });
    filterDiv.innerHTML = filterHtml;
    listEl.appendChild(filterDiv);

    filterDiv.addEventListener('change', (e) => {
       if (e.target.classList.contains('year-filter-cb')) {
         window.currentYearFilter = new Set([e.target.value]);
         
         const blocks = listEl.querySelectorAll('.school-setting-block');
         blocks.forEach(block => {
           const yInput = block.querySelector('.school-year-input');
           const yVal = (yInput && yInput.value.trim()) || '미지정';
           if (window.currentYearFilter.has(yVal)) {
             block.style.display = 'block';
           } else {
             block.style.display = 'none';
           }
         });
       }
    });
  }

  
  window.SCHOOL_QUESTIONS_MAP.forEach((school, sIndex) => {
    const sBlock = document.createElement('div');
    sBlock.className = 'school-setting-block';
    const sYear = school.admissionYear || '미지정';
    if (window.currentYearFilter && !window.currentYearFilter.has(sYear)) {
      sBlock.style.display = 'none';
    }
    sBlock.style.cssText = "border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 12px; background: rgba(0,0,0,0.1);";
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = "display: flex; gap: 10px; align-items: center; margin-bottom: 10px;";
    header.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-right: auto;">
        <label style="font-size: 14px; color:var(--text-muted); white-space:nowrap;">학교명</label>
        <input type="text" class="form-control school-name-input" value="${school.name}" style="width: 180px; font-size: 16px; font-weight: bold; color: #38bdf8; background-color: rgba(56, 189, 248, 0.05);">
        
        <label style="font-size: 14px; color:var(--text-muted); white-space:nowrap; margin-left: 5px;">적용 학년도</label>
        <input type="text" class="form-control school-year-input" value="${school.admissionYear || ''}" placeholder="예: 2027" style="width: 120px; font-size: 16px; font-weight: bold; color: #facc15; text-align: center; background-color: rgba(250, 204, 21, 0.05);">
      </div>
      
      <div style="display:flex; align-items:center; margin-right: 15px;">
        <label style="font-size: 14px; color:#fff; cursor: pointer; display: flex; align-items: center; gap: 5px;">
          <input type="checkbox" class="school-include-spaces" ${school.includeSpaces !== false ? 'checked' : ''}> 공백 포함 계산
        </label>
      </div>
      <button class="btn-action" style="padding: 6px 10px;" onclick="addSchoolQuestion(${sIndex})"><i class="fa-solid fa-plus"></i> 문항 추가</button>
      <button class="btn-action" style="background-color: var(--color-danger); padding: 6px 10px;" onclick="deleteSchool(${sIndex})"><i class="fa-solid fa-trash"></i> 삭제</button>
    `;
    sBlock.appendChild(header);
    
    // Questions
    school.questions.forEach((q, qIndex) => {
      if (!q.details) q.details = [];
      const qDiv = document.createElement('div');
      qDiv.className = 'q-item';
      qDiv.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding-left: 15px; border-left: 2px solid var(--color-primary);";
      
      let dragCounter = 0;
      qDiv.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        qDiv.style.boxShadow = '0 -4px 0 var(--color-success)';
        qDiv.style.transition = 'box-shadow 0.1s';
      });
      qDiv.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
          qDiv.style.boxShadow = '';
        }
      });
      qDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      qDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        qDiv.style.boxShadow = '';
        
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;
        try {
          const data = JSON.parse(dataStr);
          if (data.sIndex !== sIndex) return;
          const fromIdx = data.qIndex;
          const toIdx = qIndex;
          if (fromIdx === toIdx) return;
          syncSchoolInputs();
          const targetSchool = window.SCHOOL_QUESTIONS_MAP[sIndex];
          const movedItem = targetSchool.questions.splice(fromIdx, 1)[0];
          targetSchool.questions.splice(toIdx, 0, movedItem);
          renderSettingsSchools();
        } catch(err) { console.error(err); }
      });

      const qMain = document.createElement('div');
      qMain.style.cssText = "display: flex; gap: 10px; align-items: flex-start; width: 100%;";
      qMain.innerHTML = `
        <div draggable="true" ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({ sIndex: ${sIndex}, qIndex: ${qIndex} })); this.parentElement.parentElement.style.opacity = '0.5';" ondragend="this.parentElement.parentElement.style.opacity = '1';" style="display: flex; align-items: center; justify-content: center; cursor: grab; padding-right: 5px; color: var(--text-muted); height: 40px;">
          <i class="fa-solid fa-bars"></i>
        </div>
        <div style="width: 150px;">
          <input type="text" class="form-control q-label" value="${q.label}" placeholder="항목명">
        </div>
        <div style="flex: 1; display: flex; gap: 8px;">
          <textarea class="form-control q-content" style="resize: none; min-height: 40px; line-height: 1.4; padding: 6px; overflow: hidden; flex: 1;" placeholder="문항 내용" oninput="this.style.height='auto'; this.style.height=this.scrollHeight+'px';">${q.content}</textarea>
          <button class="btn-action" style="padding: 8px 12px; font-size: 13px; height: 40px; white-space: nowrap;" onclick="addSchoolQuestionDetail(${sIndex}, ${qIndex})"><i class="fa-solid fa-plus"></i> 상세 추가</button>
        </div>
        <div style="width: 120px;">
          <input type="number" class="form-control q-limit" value="${q.limit}" placeholder="글자수">
        </div>
        <button class="btn-action" style="background-color: var(--color-danger); padding: 8px 12px; height: 40px;" onclick="deleteSchoolQuestion(${sIndex}, ${qIndex})"><i class="fa-solid fa-xmark"></i></button>
      `;
      
      qDiv.appendChild(qMain);
      
      const detailsContainer = document.createElement('div');
      detailsContainer.style.cssText = "padding-left: 30px; display: flex; flex-direction: column; gap: 6px;";
      
      q.details.forEach((detail, dIndex) => {
        const dDiv = document.createElement('div');
        dDiv.className = 'detail-item';
        dDiv.style.cssText = "display: flex; gap: 10px; align-items: center;";
        dDiv.innerHTML = `
          <div style="width: 20px; color: var(--text-muted); text-align: right;"><i class="fa-solid fa-arrow-turn-up" style="transform: rotate(90deg);"></i></div>
          <div style="flex: 1;">
            <input type="text" class="form-control detail-title" value="${detail.title}" placeholder="소문항 제목 (예: 수학 역량)">
          </div>
          <div style="width: 120px;">
            <input type="number" class="form-control detail-limit" value="${detail.limit}" placeholder="글자수">
          </div>
          <button class="btn-action" style="background-color: var(--color-danger); padding: 4px 8px;" onclick="deleteSchoolQuestionDetail(${sIndex}, ${qIndex}, ${dIndex})"><i class="fa-solid fa-xmark"></i></button>
        `;
        detailsContainer.appendChild(dDiv);
      });
      
      qDiv.appendChild(detailsContainer);
      sBlock.appendChild(qDiv);
    });
    
    listEl.appendChild(sBlock);
  });
  
  setTimeout(() => {
    document.querySelectorAll('.q-content').forEach(ta => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
  }, 10);
}

window.addSchoolQuestion = function(sIndex) {
  syncSchoolInputs();
  window.SCHOOL_QUESTIONS_MAP[sIndex].questions.push({ label: '', content: '', limit: '' });
  renderSettingsSchools();
};
window.deleteSchoolQuestion = function(sIndex, qIndex) {
  syncSchoolInputs();
  window.SCHOOL_QUESTIONS_MAP[sIndex].questions.splice(qIndex, 1);
  renderSettingsSchools();
};
window.addSchoolQuestionDetail = function(sIndex, qIndex) {
  syncSchoolInputs();
  if (!window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].details) {
    window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].details = [];
  }
  window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].details.push({ title: '', limit: '' });
  renderSettingsSchools();
};
window.deleteSchoolQuestionDetail = function(sIndex, qIndex, dIndex) {
  syncSchoolInputs();
  window.SCHOOL_QUESTIONS_MAP[sIndex].questions[qIndex].details.splice(dIndex, 1);
  renderSettingsSchools();
};
window.deleteSchool = function(sIndex) {
  syncSchoolInputs();
  window.SCHOOL_QUESTIONS_MAP.splice(sIndex, 1);
  renderSettingsSchools();
};



/**
 * 30가지 평가 항목 점수 산정근거 모달 열기
 */
async function openScoreDetailsModal(studentLink) {
  if (CURRENT_ROLE === '학생' || CURRENT_ROLE === '게스트') {
    alert('상세 채점 내역 조회 권한이 없습니다. 교사나 관리자만 조회 가능합니다.');
    return;
  }

  const modal = document.getElementById('modal-score-details');
  const summaryCard = document.getElementById('score-details-summary-card');
  const grid = document.getElementById('score-details-grid');
  
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentLink));
  if (!student) return;
  
  const scoreVal = String(student.recordScore || 0);
  const displayScore = scoreVal.includes('🚨') ? scoreVal.replace(' 🚨', '').replace('🚨', '').trim() + '점 🚨' : scoreVal + '점';

  summaryCard.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h4 style="margin: 0 0 5px 0; color: #fff;">${student.name} 학생 (${student.school} / 지원: ${student.targetSchool})</h4>
        <span style="font-size: 14px; color: var(--text-muted);">연락처: ${student.studentPhone}</span>
      </div>
      <div style="text-align: right;">
        <span style="font-size: 20px; font-weight: bold; color: var(--color-primary);">${displayScore}</span>
        <span style="font-size: 14px; color: var(--text-muted); display: block;" id="score-basis-time">조회 중...</span>
      </div>
    </div>
    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 14px; line-height: 1.6;" id="score-details-report-text">
      AI 리포트 데이터를 불러오는 중입니다...
    </div>
  `;
  grid.innerHTML = '<p class="text-muted" style="grid-column: span 2; padding: 20px 0; text-align: center;">데이터를 불러오는 중입니다...</p>';
  
  modal.classList.add('open');
  
  try {
    const reqPw = sessionStorage.getItem('user_pw') || '';
    const res = await ApiClient.post('getScoreDetailsBasis', { studentId: studentLink, clientRole: CURRENT_ROLE, authPw: reqPw });
    if (res.success) {
      document.getElementById('score-basis-time').textContent = `평가일시: ${formatTimestamp(res.timestamp) || '-'}`;
      let cleanReport = res.report || res.analysisReport || '분석 리포트가 존재하지 않습니다.';
      cleanReport = cleanReport.replace(/##.*SYSTEM_DATA[\s\S]*/, '').trim();

      const cardsForMath = res.scoreCards || (res.json ? (typeof res.json === 'string' ? JSON.parse(res.json) : res.json) : []);
      let area1Math = 0; for(let i=0; i<12; i++) { if(cardsForMath[i]) area1Math += cardsForMath[i].score; }
      let area2Math = 0; for(let i=12; i<18; i++) { if(cardsForMath[i]) area2Math += cardsForMath[i].score; }
      let area3Math = 0; for(let i=18; i<30; i++) { if(cardsForMath[i]) area3Math += cardsForMath[i].score; }
      const finalScoreMath = res.totalScore || res.total || (area1Math + area2Math + area3Math) || 0;

      // AI의 수학 연산 오류 강제 치환
      cleanReport = cleanReport.replace(/\*\*학업역량.*\*\*.*점/g, '**학업역량 (210점 만점)**: ' + area1Math + ' 점');
      cleanReport = cleanReport.replace(/\*\*진로적합성.*\*\*.*점/g, '**진로적합성 (75점 만점)**: ' + area2Math + ' 점');
      cleanReport = cleanReport.replace(/\*\*인성.*\*\*.*점/g, '**인성 (115점 만점)**: ' + area3Math + ' 점');
            cleanReport = cleanReport.replace(/\*\*🔥 종합 생기부 평가 점수\*\*:.*만점/g, '**🔥 종합 생기부 평가 점수**: ' + finalScoreMath + ' 점 / 160점 만점');

      // 프론트엔드 UI에서는 ADMIN_ONLY 마크다운 텍스트 블록 전체를 무조건 날려버림 (아래 예쁜 그리드 UI 카드로 대체되므로 중복 표시 방지)
      cleanReport = cleanReport.replace(/\n*<!-- ADMIN_ONLY_START -->[\s\S]*?<!-- ADMIN_ONLY_END -->\n*(?=-{3})/g, '\n');

      document.getElementById('score-details-report-text').innerHTML = `
        <strong style="display: block; margin-bottom: 8px; color: var(--color-primary);"><i class="fa-solid fa-robot"></i> AI 종합 평가 리포트</strong>
        <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 6px; line-height: 1.6;">${parseMarkdownToHtml(cleanReport)}</div>
      `;
      
      const details = res.scoreDetails || {};
      
      renderScoreBasisCards(res.scoreCards || [], CURRENT_ROLE);
      const gridTitle = `
        <div style="grid-column: span 2; margin-top: 10px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.1);">
          <h3 style="color: var(--color-primary); margin: 0 0 10px 0;">
            <i class="fa-solid fa-list-check"></i> 30개 세부 항목별 채점 주요 근거
          </h3>
        </div>
      `;
      grid.insertAdjacentHTML('afterbegin', gridTitle);
    } else {
      throw new Error(res.error || '조회 실패');
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-muted" style="grid-column: span 2; padding: 20px 0; text-align: center; color: var(--color-danger);">데이터 조회 실패: ${err.message}</p>`;
  }
}

/**
 * 30가지 평가 항목 산정근거 그리드 렌더러
 */
function renderScoreBasisCards(cards, role) {
  const grid = document.getElementById('score-details-grid');
  grid.innerHTML = '';
  
  cards.forEach(spec => {
    const card = document.createElement('div');
    card.className = 'score-details-card';
    
    let quotesHtml = '';
    if (Array.isArray(spec.quote) && spec.quote.length > 0) {
      quotesHtml = '<ul style="margin:4px 0 0 20px; padding:0; list-style-type: disc; color: var(--color-primary);">' + 
                   spec.quote.map((q, idx, arr) => {
                     let displayQ = q;
                     if (role !== '관리자') {
                       displayQ = displayQ.replace(/소계\s*\d+(\.\d+)?점/g, '').trim();
                     }
                     if (role === '교사') {
                       displayQ = displayQ.replace(/\(-25점\)/g, '').trim();
                     }
                     if (q.includes('학기]') || q.includes('학년]')) {
                       let html = '<li style="margin-top: 12px; color: var(--color-warning, #ffeb3b); font-weight: bold; list-style: none; margin-left: -20px;">▶ ' + displayQ + '</li>';
                       const nextQ = arr[idx + 1];
                       const isNextHeader = nextQ ? (nextQ.includes('학기]') || nextQ.includes('학년]')) : true;
                       if (isNextHeader) {
                         html += '<li style="color: var(--text-muted); font-size: 13px; font-style: italic; list-style: none; margin-left: -4px;">- 기재 내용 없음 -</li>';
                       }
                       return html;
                     }
                     return '<li>' + displayQ + '</li>';
                   }).join('') + 
                   '</ul>';
    } else {
      quotesHtml = '<span>- 기재 내용 없음 -</span>';
    }

    let descHtml = '';
    if (role !== '교사') {
      descHtml = '<p style="font-size: 14px; color: var(--text-muted); margin: 6px 0;">' + spec.desc + '</p>';
    }
    if (role === '관리자' && spec.range) {
      descHtml += '<div style="margin: 6px 0 8px 0; display: flex; align-items: flex-start; gap: 6px;"><span style="flex-shrink: 0; padding: 3px 6px; font-size: 11px; font-weight: bold; color: #fff; background-color: var(--color-primary); border-radius: 4px; line-height: 1;"><i class="fa-solid fa-magnifying-glass" style="margin-right: 3px;"></i>탐색</span><div style="font-size: 12px; color: var(--text-muted); line-height: 1.35; word-break: keep-all; margin-top: 1px;">' + spec.range.replace('🔍 탐색 범위: ', '') + '</div></div>';
    }

    card.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center;">' +
        '<h4>' + spec.title + '</h4>' +
        (role === '관리자' ? '<span class="score-badge">' + spec.score + ' / ' + spec.max + ' 점</span>' : '') +
      '</div>' + descHtml +
      '<div class="quote-box" style="margin-top: 8px; background: rgba(0,0,0,0.3); border-left: 3px solid var(--color-primary); padding: 8px; font-size: 14px; border-radius: 0 4px 4px 0;">' +
        '<i class="fa-solid fa-quote-left" style="font-size: 14px; opacity: 0.5; margin-right: 4px; float: left; margin-top: 2px;"></i>' +
        '<div style="overflow: hidden;">' + quotesHtml + '</div>' +
      '</div>';
    grid.appendChild(card);
  });
}

/**
 * 대상 학교 드롭다운 목록 동적 업데이트
 */
let SETTINGS_SCHOOLS = ['세종국제고', '대전외고', '충남외고', '경기외고'];

function updateTargetSchoolDropdowns(schoolsList) {
  SETTINGS_SCHOOLS = schoolsList.filter(s => s.trim() !== '');
  
  const filterSelect = document.getElementById('filter-target-school');
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="전체">모든 지원학교</option>';
    SETTINGS_SCHOOLS.forEach(school => {
      const opt = document.createElement('option');
      opt.value = school;
      opt.textContent = school;
      filterSelect.appendChild(opt);
    });
  }
  
  const regSelect = document.getElementById('reg-target-school');
  if (regSelect) {
    regSelect.innerHTML = '<option value="">학교 선택</option>';
    SETTINGS_SCHOOLS.forEach(school => {
      const opt = document.createElement('option');
      opt.value = school;
      opt.textContent = school;
      regSelect.appendChild(opt);
    });
  }
}

/**
 * 일괄 처리 프로그레스바 생성 및 업데이트 유틸리티
 */
function showProgressBar(title, total) {
  let progressContainer = document.getElementById('bulk-progress-panel');
  if (!progressContainer) {
    progressContainer = document.createElement('div');
    progressContainer.id = 'bulk-progress-panel';
    progressContainer.style.cssText = `
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 15px;
      margin-bottom: 16px;
    `;
    const tableControls = document.querySelector('.table-controls');
    tableControls.parentNode.insertBefore(progressContainer, tableControls);
  }
  
  progressContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span style="font-size: 14px; font-weight: bold; color: var(--color-primary);">${title}</span>
      <span style="font-size: 14px; color: var(--text-muted);" id="bulk-progress-text">준비 중... (0/${total}명)</span>
    </div>
    <div style="background: rgba(255,255,255,0.05); border-radius: 5px; height: 10px; overflow: hidden; width: 100%;">
      <div id="bulk-progress-bar" style="background: linear-gradient(90deg, var(--color-primary), var(--color-success)); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
    </div>
  `;
}

function updateProgressBar(current, total, statusText) {
  const bar = document.getElementById('bulk-progress-bar');
  const text = document.getElementById('bulk-progress-text');
  if (bar && text) {
    const percent = Math.round((current / total) * 100);
    bar.style.width = `${percent}%`;
    text.textContent = `${statusText} (${current}/${total}명 완료)`;
  }
}

function hideProgressBar() {
  const panel = document.getElementById('bulk-progress-panel');
  if (panel) panel.remove();
}

/**
 * 기존 일괄 AI 관련 함수들 (runBulkAIEval, runBulkAIFeedback, runBulkAIQuestions) 전면 삭제됨
 */

/**
 * 역할 및 권한별 사용안내 패널 렌더러
 */
function renderUserGuideContent() {
  const container = document.getElementById('user-guide-content');
  if (!container) return;
  
  let html = '';
  
  if (CURRENT_ROLE === '학생') {
    html = `
      <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); padding: 25px; border-radius: 12px; font-size: 14px; line-height: 1.7;">
        <h4 style="color: var(--color-primary); font-size: 18px; margin-bottom: 20px;"><i class="fa-solid fa-graduation-cap"></i> 학생 시스템 이용 매뉴얼</h4>
        
        <div style="margin-bottom: 25px;">
          <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-pen-nib" style="color: var(--color-primary); margin-right: 8px;"></i> 1. 자기소개서 작성 및 관리</h5>
          <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--color-primary);">
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-primary); margin-right: 8px;"></i> <strong>맞춤형 문항 배정:</strong> 본인이 지원하는 학교에 맞춰 문항과 글자 수가 자동으로 설정됩니다.</li>
              <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-primary); margin-right: 8px;"></i> <strong>항목별 체크리스트:</strong> 작성창 좌측의 체크리스트를 확인하여 감점 요인(금지어 등)이나 핵심 요점 누락을 방지하세요.</li>
              <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-primary); margin-right: 8px;"></i> <strong>학생 메모 활용:</strong> 작성창 우측 상단에 브레인스토밍이나 참고할 내용을 자유롭게 메모할 수 있습니다.</li>
              <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-primary); margin-right: 8px;"></i> <strong>글자 수 체크:</strong> 편집기 하단의 글자 수는 <strong>공백을 포함</strong>하여 실시간으로 계산됩니다.</li>
              <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-primary); margin-right: 8px;"></i> <strong>수시 저장:</strong> 작성 중에는 반드시 <code>[저장하기]</code> 버튼을 눌러 내용을 안전하게 보관하세요.</li>
              <li style="font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-primary); margin-right: 8px;"></i> <strong>최종 제출 주의:</strong> <code>[최종 제출하기]</code>를 누르면 더 이상 수정할 수 없습니다. 수정을 원하실 경우 담당 선생님께 잠금 해제를 요청해야 합니다.</li>
            </ul>
          </div>
        </div>

        <div style="margin-bottom: 25px;">
          <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-comments" style="color: var(--color-primary); margin-right: 8px;"></i> 2. 면접 예상질문 직접 답변하기 <span style="color: #f59e0b;">(★중요)</span></h5>
          <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 10px; margin-left: 5px;">선생님이 만들어주신 예상 질문에 본인만의 답변을 직접 작성하며 면접을 대비하세요.</p>
          <ul style="list-style: none; padding: 0; margin: 0; margin-left: 5px;">
            <li style="margin-bottom: 8px; font-size: 14px;">① 좌측의 <strong>[예상질문 연습]</strong> 탭으로 이동합니다.</li>
            <li style="margin-bottom: 8px; font-size: 14px;">② 본인 이름 옆의 <code>[<i class="fa-solid fa-microphone"></i> 연습하기]</code> 버튼을 클릭합니다.</li>
            <li style="margin-bottom: 8px; font-size: 14px;">③ 각 번호 탭을 이동하며 편하게 답변을 작성하세요. 작성 중인 글은 <strong>자동으로 임시저장</strong>되므로 창을 닫기 전까지 날아가지 않습니다.</li>
            <li style="font-size: 14px;">④ 답변 작성을 모두 마친 후 마지막에 모달창 하단의 <code>[답변 저장하기]</code> 버튼을 딱 한 번 눌러 전체를 제출합니다.</li>
          </ul>
        </div>
        
        <div style="margin-bottom: 0;">
          <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-file-pdf" style="color: var(--color-primary); margin-right: 8px;"></i> 3. 입학요강 및 기출문제 열람</h5>
          <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 0; margin-left: 5px;">좌측 <strong>[입학요강]</strong> 및 <strong>[기출문제]</strong> 메뉴를 통해 지원하시는 학교의 모집요강과 최근 3개년 기출문제 PDF를 열람하고 면접에 대비할 수 있습니다.</p>
        </div>
      </div>
    `;
  } else if (CURRENT_ROLE === '교사') {
    html = `
      <div style="display: flex; flex-direction: column; gap: 20px; font-size: 14px; line-height: 1.7;">
        <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); padding: 25px; border-radius: 12px;">
          <h4 style="color: var(--color-success); font-size: 18px; margin-bottom: 20px;"><i class="fa-solid fa-chalkboard-user"></i> 강사 시스템 이용 매뉴얼</h4>
          
          <div style="margin-bottom: 25px;">
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-users" style="color: var(--color-success); margin-right: 8px;"></i> 1. 학생 등록 및 문자 배포, 생기부 확인</h5>
            <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--color-success);">
              <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 8px;"></i> <strong>학생 신규 등록:</strong> 좌측 메뉴 최상단의 <code>[<i class="fa-solid fa-user-plus"></i> 학생 등록 및 관리]</code> 버튼을 눌러 학생의 기본 정보와 배정 학교를 등록하세요.</li>
                <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 8px;"></i> <strong>안내 문자 배포:</strong> 대시보드의 '문자(배포)' 열에서 <code>[문자]</code> 버튼을 누르면 해당 학생의 접속 주소가 포함된 안내 문자가 복사됩니다. 그대로 붙여넣기(Ctrl+V) 하여 전송하세요.</li>
                <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 8px;"></i> <strong>합불 갱신:</strong> 대시보드의 '합불 상태' 열을 클릭해 학생의 전형 결과를 실시간으로 변경하세요.</li>
                <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 8px;"></i> <strong>학생 수정:</strong> 목록 우측 끝의 <code>[수정]</code> 버튼을 눌러 연락처나 담당 강사를 변경할 수 있습니다.</li>
                <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 8px;"></i> <strong>생기부 업로드 및 원본 열람:</strong> 대시보드의 '생기부' 열에서 아이콘을 눌러 PDF를 업로드하면, <code>[보기]</code> 버튼이 생성되어 언제든 원본을 열람할 수 있습니다.</li>
                <li style="margin-bottom: 10px; font-size: 14px;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 8px;"></i> <strong>생기부 산정 근거 확인:</strong> 학생의 <strong>생기부 점수</strong>를 클릭하면 AI가 분석한 3개 영역 요약과 함께 상세한 <strong>점수 산정 근거</strong> 창이 열립니다.</li>
                <li style="font-size: 14px; color: #ff9800;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 8px;"></i> <strong>생기부 업로드 관련 유의사항:</strong> &lt;반드시 3학년 1학기의 내신성적, 수상실적, 독서, 출결이 완료된 생기부를 올리세요. 이 항목들이 없는 경우 생기부 점수의 정확도가 현저히 떨어집니다!&gt;</li>
              </ul>
            </div>
          </div>

          <div style="margin-bottom: 25px;">
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-pen-to-square" style="color: var(--color-success); margin-right: 8px;"></i> 2. 자소서 수기 첨삭 지도</h5>
            <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 10px; margin-left: 5px;">학생의 자기소개서를 읽고 직접 첨삭 의견을 남겨 지도할 수 있습니다.</p>
            <ul style="list-style: none; padding: 0; margin: 0; margin-left: 5px;">
              <li style="margin-bottom: 8px; font-size: 14px;">① <strong>[자기소개서]</strong> 탭에서 첨삭할 학생 우측의 <code>[<i class="fa-solid fa-pen"></i> 자소서 첨삭]</code>(녹색 버튼)을 클릭합니다.</li>
              <li style="margin-bottom: 8px; font-size: 14px;">② 우측 화면 상단의 <strong>'문항별 피드백'</strong> 탭이 선택되어 있는지 확인합니다.</li>
              <li style="margin-bottom: 8px; font-size: 14px;">③ 지도 의견을 작성하고 화면 하단의 <code>[피드백 저장]</code> 버튼을 누르면 학생에게 즉시 연동됩니다. 또한 AI도움받기를 통해 <strong>&lt;각 문항별 피드백 도움&gt;</strong>을 받을 수 있습니다!</li>
              <li style="font-size: 14px; color: #3b82f6;">④ 문항별 체크리스트 확인을 통해 자소서 각 문항별 결격 사유 등의 주요 포인트를 확인할 수 있습니다. 자소서가 어느정도 완성된 학생은 상시로 체크리스트 확인해 주세요. 이 체크리스트는 학생에게 즉시 연동됩니다.</li>
            </ul>
          </div>

          <div style="margin-bottom: 25px;">
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-microphone" style="color: var(--color-success); margin-right: 8px;"></i> 3. 면접 답변 확인 및 지도</h5>
            <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 10px; margin-left: 5px;"><strong>[면접 연습]</strong> 탭에서 <code>[답변 확인]</code> 버튼을 누르면, 학생이 직접 작성한 예상질문 답변 내용을 열람하고 면접을 대비시킬 수 있습니다.</p>
          </div>


        </div>
      </div>
    `;
  } else if (CURRENT_ROLE === '관리자') {
    html = `
      <div style="display: flex; flex-direction: column; gap: 20px; font-size: 14px; line-height: 1.7;">
        <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 25px; border-radius: 12px;">
          <h4 style="color: var(--color-danger); font-size: 18px; margin-bottom: 20px;"><i class="fa-solid fa-crown"></i> 최고 관리자 시스템 매뉴얼</h4>
          
          <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 25px;">관리자는 강사가 수행하는 모든 기능(문항별 피드백, 합불 갱신 등)을 기본적으로 사용할 수 있으며, 아래와 같은 최고 권한 기능이 추가로 부여됩니다.</p>

          <div style="margin-bottom: 25px;">
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-chart-pie" style="color: var(--color-danger); margin-right: 8px;"></i> 1. 생기부 정밀 분석 (30개 항목) 열람</h5>
            <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--color-danger);">
              <p style="font-size: 14px; margin-bottom: 10px;">대시보드에서 <strong>생기부 점수</strong>를 클릭하면, 강사에게는 보이지 않는 <strong>30개 전체 평가 항목의 세부 점수와 AI 판단 근거</strong>가 기재된 정밀 모달창을 단독으로 열람할 수 있습니다.</p>
              <p style="font-size: 14px; margin-bottom: 0; color: #ff9800;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 8px;"></i> <strong>생기부 업로드 관련 유의사항:</strong> &lt;반드시 3학년 1학기의 내신성적, 수상실적, 독서, 출결이 완료된 생기부를 올리세요. 이 항목들이 없는 경우 생기부 점수의 정확도가 현저히 떨어집니다!&gt;</p>
            </div>
          </div>

          <div style="margin-bottom: 25px;">
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-bolt" style="color: var(--color-danger); margin-right: 8px;"></i> 2. 학생 일괄 AI 자동화 처리</h5>
            <ul style="list-style: none; padding: 0; margin: 0; margin-left: 5px;">
              <li style="margin-bottom: 10px; font-size: 14px;"><strong>자소서 일괄 첨삭:</strong> 자소서 탭 상단의 <code>[일괄 AI 피드백 생성]</code> 버튼을 통해 선택된 다수의 학생 자소서를 Gemini API가 일괄 자동 첨삭합니다.</li>
              <li style="margin-bottom: 10px; font-size: 14px;"><strong>면접 일괄 생성:</strong> 면접 탭 상단의 <code>[일괄 AI 예상질문 생성]</code> 버튼을 통해 여러 학생의 자소서 기반 예상질문을 한 번에 추출합니다.</li>
              <li style="font-size: 14px; color: #3b82f6;"><strong>자소서 체크리스트 지도:</strong> 문항별 체크리스트 확인을 통해 자소서 각 문항별 결격 사유 등의 주요 포인트를 확인할 수 있습니다. 자소서가 어느정도 완성된 학생은 상시로 체크리스트 확인해 주세요. 이 체크리스트는 학생에게 즉시 연동됩니다.</li>
            </ul>
          </div>



          <div style="margin-bottom: 25px;">
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-unlock-keyhole" style="color: var(--color-danger); margin-right: 8px;"></i> 3. 학생 자소서 최종 제출 락 해제</h5>
            <ul style="list-style: none; padding: 0; margin: 0; margin-left: 5px;">
              <li style="margin-bottom: 0px; font-size: 14px;">학생이 자소서를 최종 제출하여 더 이상 수정할 수 없게 된 경우, 관리자만이 자소서 편집창 내부의 <code>[최종 제출 락 해제]</code> 버튼을 눌러 재수정을 허가할 수 있습니다.</li>
            </ul>
          </div>

          <div>
            <h5 style="color: #fff; font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-sliders" style="color: var(--color-danger); margin-right: 8px;"></i> 4. 시스템 마스터 환경 설정</h5>
            <ul style="list-style: none; padding: 0; margin: 0; margin-left: 5px;">
              <li style="margin-bottom: 0px; font-size: 14px;">사이드바 하단의 <strong>[설정]</strong> 메뉴에 진입하여 시스템의 관리자/강사 비밀번호, API 키, 연동 드라이브 폴더, 각 학교별 문항 및 글자수 제한을 실시간으로 관리하십시오.</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

/**
 * AI 시스템 비서에게 질문 전송 및 답변 수신 렌더러
 */
async function sendChatbotMessage() {
  const input = document.getElementById('input-chatbot-msg');
  const area = document.getElementById('chatbot-message-area');
  if (!input || !area) return;
  
  const question = input.value.trim();
  if (!question) return;
  
  // 1. 사용자 말풍선 추가
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.style.cssText = `
    background: rgba(6, 182, 212, 0.15);
    border: 1px solid var(--border-color);
    padding: 8px 12px;
    border-radius: 8px;
    align-self: flex-end;
    max-width: 85%;
    color: #22d3ee;
  `;
  userMsg.textContent = question;
  area.appendChild(userMsg);
  
  // 스크롤 자동 이동
  area.scrollTop = area.scrollHeight;
  input.value = '';
  
  // 2. 로딩 말풍선 추가
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'msg system loading';
  loadingMsg.style.cssText = `
    background: rgba(255, 255, 255, 0.05);
    padding: 8px 12px;
    border-radius: 8px;
    align-self: flex-start;
    max-width: 85%;
    color: var(--text-muted);
  `;
  loadingMsg.textContent = '🤖 SION이 답변을 생성하는 중입니다...';
  area.appendChild(loadingMsg);
  area.scrollTop = area.scrollHeight;
  
  try {
    const res = await ApiClient.post('askProjectHelper', { question }, { hideLoader: true });
    loadingMsg.remove();
    
    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.style.cssText = `
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255,255,255,0.05);
      padding: 8px 12px;
      border-radius: 8px;
      align-self: flex-start;
      max-width: 85%;
      white-space: pre-wrap;
      color: var(--text-main);
    `;
    if (res.success) {
      botMsg.textContent = res.answer;
    } else {
      botMsg.textContent = '🚨 오류: ' + (res.error || '답변 생성에 실패했습니다.');
      botMsg.style.color = 'var(--color-danger)';
    }
    area.appendChild(botMsg);
  } catch (e) {
    loadingMsg.remove();
    const errorMsg = document.createElement('div');
    errorMsg.className = 'msg system error';
    errorMsg.style.cssText = `
      background: rgba(239, 68, 68, 0.1);
      padding: 8px 12px;
      border-radius: 8px;
      align-self: flex-start;
      max-width: 85%;
      color: var(--color-danger);
    `;
    errorMsg.textContent = '🚨 네트워크 오류로 답변을 받아오지 못했습니다.';
    area.appendChild(errorMsg);
  }
  
  area.scrollTop = area.scrollHeight;
}

/**
 * ==================================================================================
 * 📚 [Task 3] 입학요강 및 기출문제 뷰어 / PDF 검증 로직
 * ==================================================================================
 */

// 1. PDF 파일 20MB / 확장자 검증 공통 모듈
function validatePdfFile(file) {
  if (!file) return false;
  
  // 확장자 / MIME 타입 체크
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('🚨 오류: PDF 파일만 업로드 가능합니다.');
    return false;
  }
  
  // 20MB (20 * 1024 * 1024 바이트) 체크
  const MAX_SIZE = 20 * 1024 * 1024; 
  if (file.size > MAX_SIZE) {
    alert('🚨 용량 초과: 파일 크기는 20MB 이하만 가능합니다. (현재 크기: ' + (file.size / 1024 / 1024).toFixed(2) + 'MB)');
    return false;
  }
  
  return true;
}

let CURRENT_PDF_LIST = [];
const SCIENCE_SCHOOLS = [
  '세종국제고', '대전외고', '충남외고', '경기외고',
  '대원외고', '한영외고', '대일외고', '명덕외고', '서울외고', '이화외고',
  '서울국제고', '고양국제고', '동탄국제고', '청심국제고', '부산국제고', '대구국제고', '인천국제고',
  '수원외고', '성남외고', '안양외고', '과천외고', '부산외고', '경남외고', '대구외고', '울산외고',
  '전북외고', '전남외고', '제주외고', '강원외고', '청주외고', '경북외고'
];

function renderPdfList() {
  const listEl = document.getElementById('pdf-file-list');
  const iframe = document.getElementById('pdf-main-iframe');
  const placeholder = document.getElementById('pdf-viewer-placeholder');
  
  const yearFilter = document.getElementById('pdf-year-filter')?.value || '전체';
  const schoolFilter = document.getElementById('pdf-school-filter')?.value || '전체';
  
  listEl.innerHTML = '';
  iframe.style.display = 'none';
  placeholder.style.display = 'block';
  
  let filtered = CURRENT_PDF_LIST;
  
  if (yearFilter !== '전체') {
    filtered = filtered.filter(f => {
      const match = f.name.match(/(20\d{2})/);
      return match && match[1] === yearFilter;
    });
  }
  
  if (schoolFilter !== '전체') {
    filtered = filtered.filter(f => {
      let extractedSchool = SCIENCE_SCHOOLS.find(s => f.name.includes(s)) || '기타';
      return extractedSchool === schoolFilter;
    });
  }
  
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="text-muted" style="text-align:center; padding:20px;">조건에 맞는 파일이 없습니다.</div>';
    return;
  }
  
  filtered.forEach(file => {
    const itemContainer = document.createElement('div');
    itemContainer.style.cssText = 'display: flex; align-items: center; margin-bottom: 5px;';
    
    const btn = document.createElement('button');
    btn.className = 'btn-action';
    btn.style.cssText = 'flex: 1; text-align:left; background: var(--bg-surface); padding: 10px; color: var(--text-main); font-size: 14px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;';
    btn.innerHTML = `<i class="fa-regular fa-file-pdf" style="color:var(--color-danger); margin-right:5px;"></i> ${file.name}`;
    
    btn.onclick = () => {
      Array.from(listEl.children).forEach(c => {
        if(c.firstElementChild) c.firstElementChild.style.border = 'none';
      });
      btn.style.border = '1px solid var(--color-primary)';
      placeholder.style.display = 'none';
      
      const loader = document.getElementById('pdf-viewer-loader');
      if (loader) loader.style.display = 'flex';
      
      iframe.style.display = 'none'; // 로딩 중에는 숨김
      iframe.onload = () => {
        if (loader) loader.style.display = 'none';
        iframe.style.display = 'block';
      };
      
      // 수파베이스 원본 URL을 바로 넣으면 브라우저에 따라 다운로드 팝업이 뜰 수 있으므로 구글 닥스 뷰어로 감싸서 렌더링
      iframe.src = `https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`; 
    };
    
    itemContainer.appendChild(btn);
    
    if (CURRENT_ROLE === '관리자') {
      const delBtn = document.createElement('button');
      delBtn.title = '이 파일 삭제';
      delBtn.style.cssText = 'background: transparent; color: var(--color-danger); padding: 10px 15px; border: none; cursor: pointer; border-radius: 4px; transition: background 0.2s;';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      delBtn.onmouseover = () => delBtn.style.background = 'rgba(255,107,107,0.1)';
      delBtn.onmouseout = () => delBtn.style.background = 'transparent';
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if(confirm(`정말 [${file.name}] 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
          const res = await ApiClient.post('deleteGeneralPdf', { fileName: file.rawName });
          if(res.success) {
            alert('파일이 영구적으로 삭제되었습니다.');
            loadPdfFiles(CURRENT_MENU);
          } else {
            alert('삭제 실패: ' + res.error);
          }
        }
      };
      itemContainer.appendChild(delBtn);
    }
    
    listEl.appendChild(itemContainer);
  });
}

// 2. 패널 로딩 및 폴더 스캔 모방 (추후 GAS 연동)
async function loadPdfFiles(folderType) {
  const titleEl = document.getElementById('pdf-library-title');
  const listEl = document.getElementById('pdf-file-list');
  const iframe = document.getElementById('pdf-main-iframe');
  const placeholder = document.getElementById('pdf-viewer-placeholder');
  const filterContainer = document.getElementById('pdf-filter-container');
  const yearSelect = document.getElementById('pdf-year-filter');
  const schoolSelect = document.getElementById('pdf-school-filter');
  
  iframe.style.display = 'none';
  placeholder.style.display = 'block';
  
  let folderId = '';
  if (folderType === 'guide') {
    titleEl.textContent = '입학요강 목록';
    folderId = extractDriveId(document.getElementById('settings-drive-guide')?.value || '');
  }
  
  listEl.innerHTML = `<div class="text-muted" style="text-align:center; padding:20px;">
    <i class="fa-solid fa-spinner fa-spin"></i> 드라이브 동기화 중...
  </div>`;
  
  if (filterContainer) filterContainer.style.display = 'none'; // 필터 무조건 숨김
  
  setTimeout(async () => {
    if (!folderId) {
      folderId = 'admissions';
    }
    
    try {
      const response = await ApiClient.post('getFilesInFolder', { folderId }, { hideLoader: true });
      CURRENT_PDF_LIST = response.files || response || [];
      
      if (!CURRENT_PDF_LIST || CURRENT_PDF_LIST.length === 0) {
        listEl.innerHTML = '<div class="text-muted" style="text-align:center; padding:20px;">파일이 없습니다.</div>';
        return;
      }
      
      // 필터 옵션 추출
      const years = new Set();
      const schools = new Set();
      CURRENT_PDF_LIST.forEach(file => {
        const yearMatch = file.name.match(/(20\d{2})/);
        if (yearMatch) years.add(yearMatch[1]);
        
        let extractedSchool = SCIENCE_SCHOOLS.find(s => file.name.includes(s));
        if (extractedSchool) schools.add(extractedSchool);
        else schools.add('기타');
      });
      
      // 옵션 렌더링
      if (yearSelect && schoolSelect && filterContainer) {
        yearSelect.innerHTML = '<option value="전체">연도 전체</option>';
        [...years].sort().reverse().forEach(y => {
          yearSelect.innerHTML += `<option value="${y}">${y}년</option>`;
        });
        
        schoolSelect.innerHTML = '<option value="전체">학교 전체</option>';
        [...schools].sort().forEach(s => {
          schoolSelect.innerHTML += `<option value="${s}">${s}</option>`;
        });
        
        filterContainer.style.display = 'none'; // 데이터 로드 후에도 무조건 숨김
        yearSelect.onchange = renderPdfList;
        schoolSelect.onchange = renderPdfList;
      }
      
      renderPdfList();
      
    } catch (e) {
      listEl.innerHTML = `<div class="text-muted" style="text-align:center; padding:20px; color: var(--color-danger);">
        <i class="fa-solid fa-triangle-exclamation"></i> 동기화 실패<br><br>
        <span style="font-size:12px; color:var(--text-muted);">${e.message}</span>
      </div>`;
    }
  }, 600);
}



// 개별 AI 실행 기능 추가
async function runSingleAIFeedback(studentId) {
  if (!confirm('해당 학생 1명에 대해 AI 피드백을 실행하시겠습니까?')) return;
  try {
    const res = await ApiClient.post('generateAIFeedback', { studentId });
    if (res.success) {
      
      alert('개별 AI 피드백 완료!');
      loadStudentsData();
    } else {
      throw new Error(res.error);
    }
  } catch(e) {
    alert('실행 중 오류 발생: ' + e.toString());
    
  }
}

async function runSingleAIQuestions(studentId, mode) {
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentId));
  if (!student) return;

  const isPsMode = mode === 'ps' || mode === '자소서';
  
  if (isPsMode) {
    if (student.psStatus !== '최종제출') {
      alert("⚠️ 자소서가 '최종제출' 상태여야 예상질문 생성이 가능합니다.");
      return;
    }
  } else {
    if (!student.isParsed) {
      alert("⚠️ 생기부 AI 파싱이 먼저 완료되어야 예상질문 생성이 가능합니다.");
      return;
    }
  }

  if (!confirm(`해당 학생에 대해 AI ${isPsMode ? '자소서' : '생기부'} 예상질문 생성을 실행하시겠습니까?`)) return;
  try {
    const res = await ApiClient.post('generateAIQuestions', { studentId, type: isPsMode ? '자소서' : '생기부' });
    if (res.success) {
      
      alert('개별 AI 예상질문 생성 완료!');
      loadStudentsData();
    } else {
      throw new Error(res.error);
    }
  } catch(e) {
    alert('실행 중 오류 발생: ' + e.toString());
    
  }
}

async function reparseRecord(studentId) {
  if (!confirm('정말 해당 학생의 생기부를 재파싱 하시겠습니까? (기존 파싱 데이터가 삭제되고 새롭게 문자를 추출합니다. 채점은 진행되지 않습니다.)')) return;
  showProgressBar('생기부 텍스트 파싱 중...', 1);
  updateProgressBar(0, 1, 'PDF에서 텍스트를 추출하는 중...');
  try {
    const res = await ApiClient.post('parseStudentRecord', { studentId });
    if (!res.success) throw new Error(res.error);
    updateProgressBar(1, 1, '파싱 완료!');
    alert('생기부 파싱이 성공적으로 완료되었습니다! 이제 [재채점] 버튼을 눌러 채점을 진행해주세요.');
  } catch(e) {
    alert('재파싱 오류: ' + e.message);
  } finally {
    hideProgressBar();
  }
}

async function runSingleAIEval(studentId) {
  if (!confirm('해당 학생의 생기부를 바탕으로 AI 채점을 실행하시겠습니까?')) return;
  showProgressBar('단일 생기부 AI 채점 중...', 1);
  updateProgressBar(0, 1, '생기부 분석 및 채점 진행 중...');
  try {
    const res = await ApiClient.post('evaluateStudentRecord', { studentId, recordText: null });
    if (!res.success) {
      if (res.error === 'NOT_PARSED') {
        alert('생기부 파싱 데이터가 없습니다. 먼저 [재파싱] 버튼을 눌러 파싱을 진행해주세요.');
        return;
      }
      throw new Error(res.error);
    }
    updateProgressBar(1, 1, '채점 완료!');
    alert('생기부 AI 수동 채점 완료!');
    loadStudentsData();
  } catch(e) {
    alert('🚨 [에러 원문 팩트 확인용]\n실행 중 오류 발생: ' + e.message);
  } finally {
    hideProgressBar();
  }
}



window.openPdfPreview = async function(url, studentName, studentSchool) {
  if (!url || url === 'null') {
    alert('등록된 생기부 PDF 링크가 없습니다.');
    return;
  }
  
  // 만약 url이 http(s)://로 시작하지 않고 단순 파일명/UUID라면 Supabase Storage Public URL로 정제
  let fullUrl = url;
  let isSupabaseFile = false;
  let sFileName = '';
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    isSupabaseFile = true;
    sFileName = url;
    if (!sFileName.startsWith('record_') && !sFileName.endsWith('.pdf')) {
      sFileName = `record_${sFileName}.pdf`;
    } else if (!sFileName.endsWith('.pdf')) {
      sFileName = `${sFileName}.pdf`;
    }
    
    if (window.supabaseClient) {
      const { data } = window.supabaseClient.storage.from('student_records').getPublicUrl(sFileName);
      if (data && data.publicUrl) {
        fullUrl = data.publicUrl;
      }
    }
  }

  const modal = document.getElementById('modal-pdf-preview');
  const container = document.getElementById('pdf-preview-container');
  const title = document.getElementById('pdf-preview-modal-title');
  const btnDownload = document.getElementById('btn-download-pdf-preview');
  
  if (!container || !modal) {
    window.open(fullUrl, '_blank');
    return;
  }
  
  if (title) {
    title.textContent = studentName ? `📄 ${studentName} 학생 생기부 PDF 문서` : '📄 생기부 PDF 문서 열람';
  }

  if (btnDownload) {
    btnDownload.onclick = async () => {
      const sName = studentName ? studentName : '이름없음';
      const sSchool = studentSchool ? studentSchool : '소속미상';
      const outName = `[생기부] ${sName}(${sSchool}).pdf`;
      
      if (isSupabaseFile && window.supabaseClient) {
        try {
          const { data, error } = await window.supabaseClient.storage.from('student_records').download(sFileName);
          if (error) throw error;
          if (data) {
            const blobUrl = URL.createObjectURL(data);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            return;
          }
        } catch (e) {
          console.error('Supabase download error:', e);
        }
      }
      
      try {
        const res = await fetch(fullUrl);
        if (!res.ok) throw new Error('Network error');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = outName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch(e) {
        console.error('Fetch download error:', e);
        window.open(fullUrl, '_blank');
      }
    };
  }
  
  modal.classList.add('open');
  container.innerHTML = '<div style="color: #fff; text-align: center; padding: 60px 20px; font-size: 16px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; margin-bottom: 16px; color: var(--color-primary); display: block;"></i>PDF 문서를 고화질로 렌더링하는 중입니다...</div>';
  
  const cleanUrl = fullUrl.includes('?') ? fullUrl : `${fullUrl}?t=${Date.now()}`;
  
  try {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const loadingTask = window.pdfjsLib.getDocument(cleanUrl);
      const pdf = await loadingTask.promise;
      
      container.innerHTML = ''; // 로더 제거 및 스크롤 영역 준비
      container.style.overflowY = 'auto';
      container.style.padding = '20px';
      container.style.boxSizing = 'border-box';
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const scale = 1.3;
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 20px auto';
        canvas.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
        canvas.style.borderRadius = '4px';
        canvas.style.maxWidth = '100%';
        
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({ canvasContext: context, viewport }).promise;
        container.appendChild(canvas);
      }
    } else {
      throw new Error('PDF.js 엔진이 로드되지 않았습니다.');
    }
  } catch (err) {
    console.error('PDF.js 렌더링 오류:', err);
    container.innerHTML = `
      <div style="text-align: center; padding: 50px; color: #fff;">
        <p style="margin-bottom: 16px; color: #ffab00;">브라우저 보안 제약으로 인해 모달 내 렌더링에 실패했습니다.</p>
        <a href="${cleanUrl}" target="_blank" class="btn-action" style="padding: 10px 20px; background: var(--color-primary); text-decoration: none; color: #fff; border-radius: 4px; display: inline-block;">새 창에서 PDF 직접 열기</a>
      </div>
    `;
  }
};

window.saveMemo = async function() {
  if (!ACTIVE_PS_STUDENT) return;
  if (CURRENT_ROLE !== '학생') {
    alert('학생 메모는 학생 본인만 수정 및 저장할 수 있습니다. (교사/관리자는 읽기 전용)');
    return;
  }
  const memo = document.getElementById('student-memo-pad').value;
  showGlobalLoader('메모 저장 중...', 300);
  const res = await window.saveStudentMemo(ACTIVE_PS_STUDENT, memo);
  hideGlobalLoader();
  if (res && res.success) {
    alert('메모가 저장되었습니다.');
    const s = STUDENTS_LIST.find(st => st.studentLink === ACTIVE_PS_STUDENT);
    if (s) s.student_memo = memo;
  } else {
    alert('저장 실패: ' + (res ? res.error : '알 수 없는 오류'));
  }
};

window.generateChecklist = async function() {
  if (!ACTIVE_PS_STUDENT) return;
  
  const qNum = document.getElementById('ps-question-selector').value;
  const textVal = window.getCurrentPsText ? window.getCurrentPsText(true) : document.getElementById('ps-content-textarea').value;
  const rawVal = window.getCurrentPsText ? window.getCurrentPsText(false).replace(/\[상세분할\]/g, '').trim() : textVal.trim();
  
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(ACTIVE_PS_STUDENT));
  const targetSchool = student ? (student.targetSchool || student.target_school) : null;
  let totalLimit = 0;
  const matchedSchool = window.findSchoolConfig(targetSchool, student.admissionYear);
  if (matchedSchool && matchedSchool.questions) {
    const qData = matchedSchool.questions.find(q => String(q.label) === String(qNum));
    if (qData) {
      if (qData.limit && !isNaN(parseInt(qData.limit))) {
        totalLimit = parseInt(qData.limit);
      } else if (qData.details && qData.details.length > 0) {
        totalLimit = qData.details.reduce((sum, d) => sum + (parseInt(d.limit) || 0), 0);
      }
    }
  }
  
  const currentCount = getCharCount(rawVal, targetSchool, window.CURRENT_PS_STUDENT ? window.CURRENT_PS_STUDENT.admissionYear : null);
  if (totalLimit > 0) {
    if (currentCount < (totalLimit * 0.6)) {
      alert('자소서 내용이 너무 짧거나 비어있습니다.');
      return;
    }
  } else {
    if (!rawVal || rawVal === '') {
      alert('자소서 내용이 너무 짧거나 비어있습니다.');
      return;
    }
  }
  
  if (!confirm(`현재 문항(${qNum}번)에 대한 AI 체크리스트를 생성하시겠습니까?`)) return;
  
  showGlobalLoader('AI 체크리스트 분석 중...', 900);
  try {
    const res = await window.generateAIChecklist(ACTIVE_PS_STUDENT, qNum, textVal);
    hideGlobalLoader();
    if (res && res.success) {
      document.getElementById('ai-checklist-container').innerHTML = renderChecklistToHTML(res.checklist);
      const chkTitle = document.getElementById('ai-checklist-container').closest('.checklist-area').querySelector('h4');
      if (chkTitle) {
        const _d = new Date();
        const fmtDate = `${String(_d.getFullYear()).slice(-2)}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')} ${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
        chkTitle.innerHTML = `항목별 체크리스트 확인하기 <span style="font-size:11px; color:#94a3b8; font-weight:normal;">(기준일: ${fmtDate})</span>`;
      }
      
      if (window.PS_CURRENT_HISTORY) {
        if (!window.PS_CURRENT_HISTORY.aiHistory) window.PS_CURRENT_HISTORY.aiHistory = [];
        window.PS_CURRENT_HISTORY.aiHistory.push({
          type: '문항[' + qNum + ']_체크리스트',
          feedback: res.checklist,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      alert('생성 실패: ' + (res.error || '알 수 없는 오류'));
    }
  } catch (e) {
    hideGlobalLoader();
    alert('오류 발생: ' + e.message);
  }
};

window.openPsViewerModal = async function(studentLink) {
  const student = STUDENTS_LIST.find(s => String(s.studentLink) === String(studentLink));
  if (!student) return;
  
  const titleEl = document.getElementById('ps-viewer-modal-title');
  if (titleEl) titleEl.textContent = `${student.name} 학생의 자소서 전체 뷰어`;
  
  const viewerContent = document.getElementById('ps-viewer-content');
  viewerContent.innerHTML = '<div style="text-align:center; padding: 50px;" class="text-muted">로딩 중...</div>';
  
  document.getElementById('modal-ps-viewer').classList.add('open');
  
  try {
    const hData = await window.getPersonalStatementHistory(studentLink);
    if (hData && hData.current) {
      const schoolMap = window.SCHOOL_QUESTIONS_MAP || [];
      const matchedSchool = window.findSchoolConfig(student.targetSchool, student.admissionYear) || schoolMap[0];
      const questions = (matchedSchool && matchedSchool.questions) ? matchedSchool.questions : [];

      let html = '';
      const tSchool = (student.targetSchool || '').trim();

      questions.forEach(qData => {
        const qKey = qData.label.trim();
        
        // 1. 현재 타겟 학교 버전 찾기
        let matchedC = hData.current.find(c => String(c.qNum).trim() === qKey && (c.version_label || '').trim() === tSchool);
        
        // 2. 없으면 빈 꼬리표 버전(과거 마이그레이션 예외 데이터 폴백) 찾기
        if (!matchedC) {
            matchedC = hData.current.find(c => String(c.qNum).trim() === qKey && (c.version_label || '').trim() === '');
        }
        
        if (!matchedC) return; // 해당 문항에 저장된 데이터가 없으면 패스
        
        const c = matchedC;
        const qPrompt = qData.content || '문항 정보를 불러올 수 없습니다.';
        const qTitle = `[${c.qNum}]`;

        let renderedText = '<span class="text-muted">내용 없음</span>';
        if (c.text) {
          if (c.text.includes('[상세분할]')) {
            const parts = c.text.split('[상세분할]');
            renderedText = parts.map((p, idx) => {
              // 목표 2: 빈 텍스트 버그 방지 및 기본 내용 없음 처리
              const partText = p.trim();
              const partContent = partText ? partText : '<span class="text-muted">내용 없음</span>';
              
              // 목표 1: qData 객체의 details 정보를 활용한 동적 제목 바인딩
              const partTitle = (qData && qData.details && qData.details[idx] && qData.details[idx].title) 
                ? qData.details[idx].title 
                : `세부항목 ${idx + 1}`;
                
              return `<div style="margin-bottom: 12px; padding: 12px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);"><strong style="color: var(--color-primary); font-size: 13px; display: block; margin-bottom: 6px;">[${partTitle}]</strong>${partContent}</div>`;
            }).join('');
          } else {
            renderedText = c.text;
          }
        }

        html += `<div style="margin-top: 20px;" class="ps-print-block">`;
        html += `  <h4 class="ps-print-title" style="color: #a5b4fc; margin-bottom: 8px;">${qTitle}</h4>`;
        html += `  <div class="ps-print-prompt" style="font-size: 13px; color: #94a3b8; margin-bottom: 12px; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 4px; border-left: 3px solid #a5b4fc; line-height: 1.4;">${qPrompt}</div>`;
        html += `  <div class="ps-print-answer" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 6px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${renderedText}</div>`;
        html += `</div>`;
      });
      viewerContent.innerHTML = html;
    } else {
      viewerContent.innerHTML = '<div style="text-align:center; padding: 50px;" class="text-muted">작성된 자소서 내용이 없습니다.</div>';
    }
    
    const btnDownloadPsPdf = document.getElementById('btn-download-ps-pdf');
    if (btnDownloadPsPdf) {
      btnDownloadPsPdf.onclick = async () => {
        const sName = student.name ? student.name : '이름없음';
        const sSchool = student.school ? student.school : '소속미상';
        const outName = `[자소서] ${sName}(${sSchool}).pdf`;
        
        // 1. 깜빡임 방지를 위한 가상 복제본(Clone) 생성
        const clone = viewerContent.cloneNode(true);
        
        // 2. 최상단 학생 이름 타이틀 동적 주입
        const titleEl = document.createElement('h2');
        titleEl.innerText = `${sName} 학생의 자기소개서`;
        titleEl.style.textAlign = 'center';
        titleEl.style.marginBottom = '30px';
        titleEl.style.color = '#000000';
        titleEl.style.borderBottom = '2px solid #333';
        titleEl.style.paddingBottom = '10px';
        clone.insertBefore(titleEl, clone.firstChild);
        
        // 3. 복제본 인쇄용 스타일 세탁
        clone.style.color = '#000000';
        clone.style.backgroundColor = '#ffffff';
        clone.style.padding = '20px';
        
        const h4s = clone.querySelectorAll('.ps-print-title');
        h4s.forEach(h => {
          h.style.color = '#16a34a';
          h.style.fontWeight = 'bold';
        });

        const prompts = clone.querySelectorAll('.ps-print-prompt');
        prompts.forEach(p => {
          p.style.color = '#000000';
          p.style.backgroundColor = '#f3f4f6';
          p.style.borderLeftColor = '#555555';
        });

        const answers = clone.querySelectorAll('.ps-print-answer');
        answers.forEach(a => {
          a.style.backgroundColor = 'transparent';
          a.style.color = '#000000';
          a.style.border = '1px solid #999999';
          a.style.whiteSpace = 'normal';
          
          const lines = a.innerText.split('\n');
          a.innerHTML = lines.map(line => `<div style="page-break-inside: avoid; min-height: 1.4em;">${line}</div>`).join('');
        });
        
        try {
          if (typeof html2pdf !== 'undefined') {
            await html2pdf().set({
              margin: 15,
              filename: outName,
              image: { type: 'jpeg', quality: 1 },
              html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
              pagebreak: { mode: ['css', 'legacy'] }
            }).from(clone).save(); // 복제본 다이렉트 주입 (백지 버그 방어 및 화면 깜빡임 차단)
          } else {
            alert('PDF 변환 라이브러리를 불러오지 못했습니다.');
          }
        } catch(err) {
          console.error('PDF 다운로드 에러:', err);
          alert('PDF 다운로드 중 오류가 발생했습니다.');
        }
      };
    }
    
  } catch(e) {
    viewerContent.innerHTML = `<div style="text-align:center; padding: 50px; color: var(--color-danger);">오류 발생: ${e.message}</div>`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-close-ps-viewer-modal')?.addEventListener('click', () => {
    document.getElementById('modal-ps-viewer').classList.remove('open');
  });
  document.getElementById('btn-close-ps-viewer-bottom')?.addEventListener('click', () => {
    document.getElementById('modal-ps-viewer').classList.remove('open');
  });
  
  document.getElementById('checkbox-hide-hidden')?.addEventListener('change', () => {
    if (typeof renderMainTable === 'function') renderMainTable();
  });
  
  document.getElementById('btn-save-memo')?.addEventListener('click', window.saveMemo);
  document.getElementById('btn-generate-ai-checklist')?.addEventListener('click', window.generateChecklist);
});

window.verifyBackupPassword = function() {
  const pw = prompt('데이터베이스 백업을 진행하려면 관리자 비밀번호를 다시 한 번 입력하세요.');
  if (pw === 'w2027pass!@#') {
    document.getElementById('modal-db-backup').classList.add('open');
  } else if (pw !== null) {
    alert('비밀번호가 일치하지 않습니다.');
  }
};

window.downloadTableCSV = async function(tableName) {
  if (!window.supabaseClient) {
    alert('Supabase 클라이언트가 초기화되지 않았습니다.');
    return;
  }
  
  try {
    const { data, error } = await window.supabaseClient.from(tableName).select('*');
    if (error) throw error;
    if (!data || data.length === 0) {
      alert(tableName + ' 테이블에 데이터가 없습니다.');
      return;
    }
    
    const headers = Object.keys(data[0]);
    let csvContent = '\uFEFF' + headers.join(',') + '\n';
    
    data.forEach(row => {
      const rowArr = headers.map(header => {
        let cell = row[header] === null || row[header] === undefined ? '' : String(row[header]);
        cell = cell.replace(/"/g, '""');
        if (cell.includes(',') || cell.includes('\n') || cell.includes('"') || cell.includes('\r')) {
          cell = `"${cell}"`;
        }
        return cell;
      });
      csvContent += rowArr.join(',') + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_${tableName}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
  } catch (err) {
    alert(tableName + ' 백업 실패: ' + err.message);
  }
};




/**
 * 공통과제 모달 기능
 */
let CURRENT_ASSIGNMENT_STUDENT_LINK = '';
window.openAssignmentPractice = async function(studentLink, admissionYear) {
  CURRENT_ASSIGNMENT_STUDENT_LINK = studentLink;
  const modal = document.getElementById('modal-assignment-practice');
  const qText = document.getElementById('assignment-question-text');
  const aText = document.getElementById('assignment-answer-textarea');
  
  qText.textContent = '해당 학년도 공통과제를 불러오는 중...';
  aText.value = '';
  modal.classList.add('open');

  try {
    // 1. 공통과제 내용 불러오기
    const { data: settingsRow } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'common_assignments').single();
    let assignmentText = '해당 학년도에 등록된 공통과제가 없습니다.';
    if(settingsRow && settingsRow.setting_value) {
      const assignments = JSON.parse(settingsRow.setting_value);
      const match = assignments.find(a => a.year === admissionYear);
      if(match && match.content) {
        assignmentText = match.content;
      }
    }
    qText.textContent = assignmentText;

    // 2. 학생의 기존 답변 불러오기
    const { data: answerRow } = await window.supabaseClient.from('common_assignments_answers').select('answer_text').eq('student_id', studentLink).single();
    if(answerRow && answerRow.answer_text) {
      aText.value = answerRow.answer_text;
    }
    
    // 권한 처리
    if (CURRENT_ROLE !== '학생') {
      aText.setAttribute('readonly', 'true');
      document.getElementById('btn-save-assignment-answer').style.display = 'none';
    } else {
      aText.removeAttribute('readonly');
      document.getElementById('btn-save-assignment-answer').style.display = 'inline-block';
    }

  } catch(err) {
    console.error(err);
    if(qText.textContent === '해당 학년도 공통과제를 불러오는 중...') {
      qText.textContent = '불러오는 중 오류가 발생했습니다. 학년도 및 데이터베이스 연결을 확인하세요.';
    }
  }
};

document.getElementById('btn-close-assignment-modal').addEventListener('click', () => {
  document.getElementById('modal-assignment-practice').classList.remove('open');
});
document.getElementById('btn-close-assignment-practice-modal').addEventListener('click', () => {
  document.getElementById('modal-assignment-practice').classList.remove('open');
});

document.getElementById('btn-save-assignment-answer').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-assignment-answer');
  const aText = document.getElementById('assignment-answer-textarea').value.trim();
  const orgText = btn.textContent;
  btn.textContent = '저장 중...';
  
  try {
    // Upsert equivalent logic
    const { data: existing } = await window.supabaseClient.from('common_assignments_answers').select('id').eq('student_id', CURRENT_ASSIGNMENT_STUDENT_LINK).single();
    let res;
    if (existing) {
      res = await window.supabaseClient.from('common_assignments_answers')
        .update({ answer_text: aText, updated_at: new Date().toISOString() })
        .eq('student_id', CURRENT_ASSIGNMENT_STUDENT_LINK);
    } else {
      // Find admission year
      const { data: stu } = await window.supabaseClient.from('students').select('admission_year, admissionYear').eq('student_link', CURRENT_ASSIGNMENT_STUDENT_LINK).single();
      const year = stu ? (stu.admission_year || stu.admissionYear) : '';
      res = await window.supabaseClient.from('common_assignments_answers')
        .insert({ student_id: CURRENT_ASSIGNMENT_STUDENT_LINK, admission_year: year, answer_text: aText });
    }
    
    if (res.error) throw res.error;
    
    alert('공통과제 답변이 저장되었습니다.');
  } catch(e) {
    console.error(e);
    alert('저장 실패: ' + e.message);
  } finally {
    btn.textContent = orgText;
  }
});

/**
 * 환경 설정: 공통과제 영역 렌더링 및 저장
 */


let SETTINGS_COMMON_ASSIGNMENTS = [];
let CURRENT_SELECTED_ASSIGNMENT_INDEX = -1;
let CURRENT_ASSIGNMENT_ANSWERS = {};

async function renderSettingsAssignments() {
  const container = document.getElementById('settings-assignment-list');
  if(!container) return;
  container.innerHTML = '';
  
  // [학년도 필터 UI 추가]
  const allYears = Array.from(new Set(SETTINGS_COMMON_ASSIGNMENTS.map(s => s.year || '미지정'))).sort((a,b) => b.localeCompare(a));
  if (!window.currentAssignmentYearFilter && allYears.length > 0) {
    window.currentAssignmentYearFilter = new Set([allYears[0]]);
  } else if (!window.currentAssignmentYearFilter) {
    window.currentAssignmentYearFilter = new Set();
  }

  if (allYears.length > 0) {
    const filterDiv = document.createElement('div');
    filterDiv.style.cssText = "margin-bottom: 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px; display:flex; gap: 15px; align-items:center; flex-wrap:wrap;";
    let filterHtml = '<strong style="color:var(--text-muted);"><i class="fa-solid fa-filter"></i> 학년도 필터:</strong>';
    allYears.forEach(y => {
       const checked = window.currentAssignmentYearFilter.has(y) ? 'checked' : '';
       filterHtml += `<label style="cursor:pointer; display:flex; align-items:center; gap:5px; color:#fff; font-size:14px;"><input type="radio" name="assign-year-filter" class="assign-year-filter-cb" value="${y}" ${checked}> ${y === '미지정' ? '미지정' : y + '학년도'}</label>`;
    });
    filterDiv.innerHTML = filterHtml;
    container.appendChild(filterDiv);

    filterDiv.addEventListener('change', (e) => {
       if (e.target.classList.contains('assign-year-filter-cb')) {
         window.currentAssignmentYearFilter = new Set([e.target.value]);
         
         const blocks = container.querySelectorAll('.assign-setting-block');
         blocks.forEach(block => {
           const yInput = block.querySelector('.assign-year-input');
           const yVal = (yInput && yInput.value.trim()) || '미지정';
           if (window.currentAssignmentYearFilter.has(yVal)) {
             block.style.display = 'block';
           } else {
             block.style.display = 'none';
           }
         });
       }
    });
  }
  
  SETTINGS_COMMON_ASSIGNMENTS.forEach((assignData, yearIndex) => {
    const box = document.createElement('div');
    box.className = 'school-config-box assign-setting-block';
    
    const blockYear = assignData.year || '미지정';
    if (!window.currentAssignmentYearFilter.has(blockYear)) {
      box.style.display = 'none';
    }
    box.style.cssText = "border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 12px; background: rgba(0,0,0,0.1);";
    
    // Header (Year)
    const header = document.createElement('div');
    header.className = 'school-header';
    header.style.display = 'flex';
    header.style.gap = '15px';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';
    
    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = "font-size: 14px; color:var(--text-muted); white-space:nowrap; margin-left: 5px;";
    labelSpan.textContent = '적용 학년도';
    
    const yearInput = document.createElement('input');
    yearInput.type = 'text';
    yearInput.className = 'form-control school-year-input assign-year-input';
    yearInput.style.cssText = "width: 120px; font-size: 16px; font-weight: bold; color: #facc15; text-align: center; background-color: rgba(250, 204, 21, 0.05);";
    yearInput.placeholder = '예: 2027';
    yearInput.value = assignData.year || '';
    yearInput.onchange = (e) => { assignData.year = e.target.value; window.isSettingsDirty = true; };
    
    const btnAddQ = document.createElement('button');
    btnAddQ.className = 'btn-action';
        btnAddQ.innerHTML = '<i class="fa-solid fa-plus"></i> 과제 문항 추가';
    btnAddQ.onclick = () => {
      assignData.questions = assignData.questions || [];
      assignData.questions.push({ label: '과제' + (assignData.questions.length + 1), content: '' });
      window.isSettingsDirty = true;
      renderSettingsAssignments();
    };
    
    const btnDelY = document.createElement('button');
    btnDelY.className = 'btn-action';
    btnDelY.style.backgroundColor = 'var(--color-danger)';
    btnDelY.style.padding = '6px 10px';
    btnDelY.innerHTML = '<i class="fa-solid fa-trash"></i> 삭제';
    btnDelY.onclick = () => {
      if(confirm('해당 학년도의 모든 공통과제를 삭제하시겠습니까?')) {
        SETTINGS_COMMON_ASSIGNMENTS.splice(yearIndex, 1);
        window.isSettingsDirty = true;
        renderSettingsAssignments();
      }
    };
    
    header.appendChild(labelSpan);
    header.appendChild(yearInput);
    
    const space = document.createElement('div');
    space.style.flex = '1';
    header.appendChild(space);
    
    header.appendChild(btnAddQ);
    header.appendChild(btnDelY);
    box.appendChild(header);
    
    // Questions List
    const qList = document.createElement('div');
    qList.className = 'question-list';
    
    (assignData.questions || []).forEach((q, qIndex) => {
      const qItem = document.createElement('div');
      qItem.className = 'q-item';
      qItem.style.display = 'flex';
      qItem.style.gap = '10px';
      qItem.style.alignItems = 'flex-start';
      qItem.style.marginBottom = '12px';
      
      const handle = document.createElement('div');
      handle.className = 'drag-handle';
      handle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      handle.style.display = 'flex';
      handle.style.alignItems = 'center';
      handle.style.height = '40px';
      handle.style.cursor = 'grab';
      handle.style.color = 'var(--text-muted)';
      handle.style.paddingRight = '5px';
      
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'form-control';
      labelInput.style.width = '120px';
      labelInput.style.height = '40px';
      labelInput.placeholder = '라벨(예: 과제1)';
      labelInput.value = q.label || '';
      labelInput.onchange = (e) => { q.label = e.target.value; window.isSettingsDirty = true; };
      
      const contentInput = document.createElement('textarea');
      contentInput.className = 'form-control';
      contentInput.style.flex = '1';
      contentInput.style.minHeight = '40px';
      contentInput.style.lineHeight = '1.4';
      contentInput.style.padding = '6px';
      contentInput.style.overflow = 'hidden';
      contentInput.style.resize = 'none';
      contentInput.oninput = function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
      };
      // 초기 높이 조정을 위해 약간의 딜레이 후 실행
      setTimeout(() => { contentInput.dispatchEvent(new Event('input')); }, 10);
      contentInput.placeholder = '과제 내용을 구체적으로 입력하세요.';
      contentInput.value = q.content || '';
      contentInput.onchange = (e) => { q.content = e.target.value; window.isSettingsDirty = true; };
      
      const btnDelQ = document.createElement('button');
      btnDelQ.className = 'btn-action btn-danger';
      btnDelQ.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      btnDelQ.style.padding = '8px 12px';
      btnDelQ.style.height = '40px';
      btnDelQ.style.backgroundColor = 'var(--color-danger)';
      btnDelQ.onclick = () => {
        assignData.questions.splice(qIndex, 1);
        window.isSettingsDirty = true;
        renderSettingsAssignments();
      };
      
      qItem.appendChild(handle);
      qItem.appendChild(labelInput);
      qItem.appendChild(contentInput);
      qItem.appendChild(btnDelQ);
      qList.appendChild(qItem);
    });
    
    box.appendChild(qList);
    container.appendChild(box);
  });
}

const btnAddAssign = document.getElementById('btn-add-assignment');
if (btnAddAssign) {
  btnAddAssign.addEventListener('click', () => {
    // 마이그레이션 방어코드 (구조가 다를 경우 초기화)
    if (SETTINGS_COMMON_ASSIGNMENTS.length > 0 && !SETTINGS_COMMON_ASSIGNMENTS[0].questions) {
       SETTINGS_COMMON_ASSIGNMENTS = [];
    }
    SETTINGS_COMMON_ASSIGNMENTS.push({ year: '', questions: [{ label: '과제1', content: '' }] });
    window.isSettingsDirty = true;
    renderSettingsAssignments();
  });
}

const btnSaveAssign = document.getElementById('btn-save-settings-assignments');
if (btnSaveAssign) {
  btnSaveAssign.addEventListener('click', async () => {
    const btn = btnSaveAssign;
    const org = btn.innerHTML;
    btn.textContent = '저장 중...';
    try {
      const payload = JSON.stringify(SETTINGS_COMMON_ASSIGNMENTS);
      const { data: exist } = await window.supabaseClient.from('settings').select('setting_key').eq('setting_key', 'common_assignments').single();
      let res;
      if (exist) {
        res = await window.supabaseClient.from('settings').update({ setting_value: payload, updated_at: new Date().toISOString() }).eq('setting_key', 'common_assignments');
      } else {
        res = await window.supabaseClient.from('settings').insert({ setting_key: 'common_assignments', setting_value: payload });
      }
      if(res.error) throw res.error;
      window.isSettingsDirty = false;
      alert('과제가 성공적으로 저장되었습니다.');
    } catch(e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 과제 저장';
    }
  });
}

window.openAssignmentPractice = async function(studentLink, admissionYear) {
  CURRENT_ASSIGNMENT_STUDENT_LINK = studentLink;
  const modal = document.getElementById('modal-assignment-practice');
  const ulList = document.getElementById('assignment-modal-list');
  const qText = document.getElementById('assignment-question-text');
  const aText = document.getElementById('assignment-answer-textarea');
  const btnSave = document.getElementById('btn-save-assignment-answer');
  
  ulList.innerHTML = '<li style="padding: 12px; color: #aaa;">로딩 중...</li>';
  qText.textContent = '데이터를 불러오는 중입니다.';
  aText.value = '';
  CURRENT_ASSIGNMENT_ANSWERS = {};
  CURRENT_SELECTED_ASSIGNMENT_INDEX = -1;
  btnSave.disabled = true;
  aText.disabled = true;
  modal.classList.add('open');

  try {
    // 1. 공통과제 질문 목록 로드
    const { data: settingsRow } = await window.supabaseClient.from('settings').select('setting_value').eq('setting_key', 'common_assignments').single();
    let questions = [];
    if(settingsRow && settingsRow.setting_value) {
      const assignments = JSON.parse(settingsRow.setting_value);
      // 구버전(단일형) 마이그레이션 호환 처리
      if (assignments.length > 0 && typeof assignments[0].content === 'string') {
        const match = assignments.find(a => a.year === admissionYear);
        if (match && match.content) questions = [{ label: '공통과제', content: match.content }];
      } else {
        const match = assignments.find(a => a.year === admissionYear);
        if (match && match.questions) questions = match.questions;
      }
    }
    
    if (questions.length === 0) {
      ulList.innerHTML = '<li style="padding: 12px; color: #ff6666;">해당 학년도 과제 없음</li>';
      qText.textContent = '해당 학년도에 등록된 공통과제가 없습니다.';
      return;
    }

    // 2. 학생의 기존 답변 로드 (JSON)
    const { data: answerRow } = await window.supabaseClient.from('common_assignments_answers').select('answer_text').eq('student_id', studentLink).single();
    if(answerRow && answerRow.answer_text) {
      try {
        // 기존 단일 텍스트 형태와 JSON 형태 호환 처리
        const parsed = JSON.parse(answerRow.answer_text);
        if(typeof parsed === 'object' && parsed !== null) {
          CURRENT_ASSIGNMENT_ANSWERS = parsed;
        } else {
          CURRENT_ASSIGNMENT_ANSWERS = { '공통과제': answerRow.answer_text, [questions[0].label]: answerRow.answer_text };
        }
      } catch(e) {
        // JSON 파싱 실패면 구버전 단일 텍스트로 간주
        CURRENT_ASSIGNMENT_ANSWERS = { [questions[0].label]: answerRow.answer_text };
      }
    }

    // 3. 좌측 탭 렌더링
    ulList.innerHTML = '';
    questions.forEach((q, idx) => {
      const li = document.createElement('li');
      li.textContent = q.label || ('과제 ' + (idx+1));
      li.style.cursor = 'pointer';
      li.style.padding = '12px 15px';
      li.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      li.style.color = '#fff';
      li.style.fontSize = '14px';
      
      li.onclick = () => {
        // 이전 입력값 임시 저장
        if (CURRENT_SELECTED_ASSIGNMENT_INDEX > -1) {
          const prevQ = questions[CURRENT_SELECTED_ASSIGNMENT_INDEX];
          CURRENT_ASSIGNMENT_ANSWERS[prevQ.label] = aText.value;
        }
        
        // 탭 UI 갱신
        Array.from(ulList.children).forEach(child => {
          child.style.backgroundColor = 'transparent';
          child.style.borderLeft = 'none';
        });
        li.style.backgroundColor = 'rgba(139, 92, 246, 0.2)';
        li.style.borderLeft = '4px solid #8b5cf6';
        
        // 내용 갱신
        CURRENT_SELECTED_ASSIGNMENT_INDEX = idx;
        qText.textContent = q.content;
        aText.value = CURRENT_ASSIGNMENT_ANSWERS[q.label] || '';
        
        if (CURRENT_ROLE === '학생') {
          aText.disabled = false;
          btnSave.disabled = false;
        }
      };
      ulList.appendChild(li);
    });

    // 권한 처리
    if (CURRENT_ROLE !== '학생') {
      document.getElementById('btn-save-assignment-answer').style.display = 'none';
    } else {
      document.getElementById('btn-save-assignment-answer').style.display = 'inline-block';
    }

    // 첫 번째 탭 강제 클릭
    if (ulList.children.length > 0) {
      ulList.children[0].click();
    }

  } catch(err) {
    console.error(err);
    ulList.innerHTML = '<li style="padding: 12px; color: #ff6666;">로딩 에러</li>';
    qText.textContent = '불러오는 중 오류가 발생했습니다.';
  }
};

const btnCloseModal = document.getElementById('btn-close-assignment-modal');
if(btnCloseModal) btnCloseModal.addEventListener('click', () => { document.getElementById('modal-assignment-practice').classList.remove('open'); });

const btnCloseModal2 = document.getElementById('btn-close-assignment-practice-modal');
if(btnCloseModal2) btnCloseModal2.addEventListener('click', () => { document.getElementById('modal-assignment-practice').classList.remove('open'); });

document.getElementById('btn-save-assignment-answer').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-assignment-answer');
  const aText = document.getElementById('assignment-answer-textarea');
  
  if (CURRENT_SELECTED_ASSIGNMENT_INDEX === -1) return;
  
  // 현재 뷰의 데이터를 JSON 객체에 업데이트
  const currentLabel = document.getElementById('assignment-modal-list').children[CURRENT_SELECTED_ASSIGNMENT_INDEX].textContent;
  CURRENT_ASSIGNMENT_ANSWERS[currentLabel] = aText.value;

  const orgText = btn.textContent;
  btn.textContent = '저장 중...';
  
  try {
    const payload = JSON.stringify(CURRENT_ASSIGNMENT_ANSWERS);
    
    const { data: existing } = await window.supabaseClient.from('common_assignments_answers').select('id').eq('student_id', CURRENT_ASSIGNMENT_STUDENT_LINK).single();
    let res;
    if (existing) {
      res = await window.supabaseClient.from('common_assignments_answers')
        .update({ answer_text: payload, updated_at: new Date().toISOString() })
        .eq('student_id', CURRENT_ASSIGNMENT_STUDENT_LINK);
    } else {
      const { data: stu } = await window.supabaseClient.from('students').select('admission_year, admissionYear').eq('student_link', CURRENT_ASSIGNMENT_STUDENT_LINK).single();
      const year = stu ? (stu.admission_year || stu.admissionYear) : '';
      res = await window.supabaseClient.from('common_assignments_answers')
        .insert({ student_id: CURRENT_ASSIGNMENT_STUDENT_LINK, admission_year: year, answer_text: payload });
    }
    
    if (res.error) throw res.error;
    
    alert('전체 공통과제 답변이 저장되었습니다.');
  } catch(e) {
    console.error(e);
    alert('저장 실패: ' + e.message);
  } finally {
    btn.textContent = orgText;
  }
});
