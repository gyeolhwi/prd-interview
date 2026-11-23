## 요약
시작 화면에서 "새 아이디어 / 유지보수"를 고를 수 있고, 유지보수를 고르면 요청된 유지보수 형식의 Pre-PRD 가 나옵니다.

## 달라지는 점
- 시작 화면에 문서 종류 선택이 생기고, 종류에 따라 입력 안내·예시가 바뀜
- 유지보수 문서: 무엇이 바뀌나요?(지금까지·앞으로·바뀌는 곳) / 왜 이 기능이 필요한가요? / 요청자는 무엇이 필요한가요? / 고객은 어떤 점이 좋아지나요? / 이번에 안 하는 것 / 잘 됐는지 어떻게 아나요? + 확인된 결정·남은 질문·부록
- 새 아이디어 흐름·문서는 그대로, 종류 없는 기존 세션은 새 아이디어로 이어짐

## 왜
이미 있는 서비스를 바꾸는 요청은 전후 비교와 요청자·고객 구분이 핵심인데, 기존 단계는 이를 묻지 않았습니다.

## 구현
- `lib/engine.ts`: `MAINT_STAGES`, `Kind`, `stagesOf()` / `confirmOf()` 로 전역 `CONFIRM` 을 세션 기준으로, 종류별 `toMarkdown()`
- `lib/interview.ts`: `create(idea, kind)`, `SECTION_GUIDE` · `docSchema()` 종류별 문서 작성
- `app/api/sessions/route.ts`: `kind` 검증 / `app/page.tsx`: 종류 선택, 종류별 단계 표시
- `docs/pre-prd.md`: 유지보수 단계표

## 리뷰 포인트
- 전역 `CONFIRM`(=5) 을 쓰던 곳이 모두 `confirmOf(s)` 로 바뀌었는지 (유지보수는 확인 단계가 6)
- 채점 결과 키 검사가 단계 수 기준(`valid()`)으로 바뀐 부분

## 확인 방법
- [x] `npm test` 10/10, `npx tsc --noEmit`, `npm run build` 통과
- [x] 실제 Claude 호출로 유지보수 흐름을 미리보기·확정까지 진행, 문서 구조 확인
- [ ] 브라우저에서 유지보수를 골라 직접 진행해 보기

## 증거
[전후 리포트 보기](https://github.com/gyeolhwi/prd-interview/issues/7#issuecomment-7094065705)

## 관련
- 이슈: [#7 유지보수 요청용 Pre-PRD 형식 추가 (문서 종류 선택)](https://github.com/gyeolhwi/prd-interview/issues/7) (통합 테스트 뒤 close)
- 커밋: 1c1fa89 FEAT(interview): 유지보수 요청도 전용 형식의 Pre-PRD 로 정리할 수 있음 - 2026-11-23
