# 작업 이력

## 2026-09-15
- **수정사항**: 다개년도 입학 지원자 데이터 누적 관리를 위한 '학년도(admission_year)' 속성 추가 및 프론트엔드 연동.
- **수정 파일**:
  - `index.html`: 학년도 필터링 및 학생 등록 모달에 콤보박스 추가
  - `script.js`: `studentData` 페이로드에 `admissionYear` 추가, 등록/수정 모달에 학년도 선택 동적 초기화 로직 구현 (기본값 현재년도+1), 메인 테이블 렌더링 시 학년도 정렬/필터 조건 추가, 모든 테이블의 첫 번째 열에 '학년도' 컬럼 표시 추가.
  - `backend_logic.js`: `getStudentsList`, `registerStudent`, `updateStudent` 함수 내 DB 페이로드 및 반환 데이터에 `admission_year` 맵핑 추가.
- **기타**: 
  - `ALTER TABLE students ADD COLUMN admission_year TEXT;` SQL 실행 요청.
