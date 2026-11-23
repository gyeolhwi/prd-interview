## 요약
화면 전체를 '질문에 답하며 문서 한 장을 채워 가는 도구'에 맞는 모습으로 바꾸고, 기본 템플릿 같던 느낌을 걷어냈습니다. 쓰는 방법은 그대로입니다.

## 달라지는 점
- 회청색 종이 위 흰 시트, 남색 글씨로 통일하고 지금 진행 중인 단계에만 노란 형광펜 표시
- 지금 답할 질문만 흰 시트로 띄우고, 점수·남은 질문·이어하기 목록은 상자 없이 정리
- 모호도 막대에 통과 기준선(0.8) 표시
- 홈 문구가 서비스가 하는 일을 설명하고, 시작 버튼은 "질문 시작"
- 문서 종류 선택이 나란히 놓인 두 칸으로 바뀜 (모바일은 세로)

## 왜
system-ui 서체, 파란 버튼, 같은 모양 카드 반복, `A · B` 메타 문자열, `단어 — 설명` 라벨 같은 기본값 패턴이 서비스 성격을 가렸습니다.

## 구현
- `app/globals.css`: 색 토큰(`--paper` `--sheet` `--ink` `--graphite` `--rule` `--marker`) 재정의, `.question` `.section` `.kind` `.resume` `.steps` 추가, `.bar::after` 로 `--pass` 위치에 기준선, 480px 이하 대응
- `app/layout.tsx`: `next/font/google` 의 `IBM_Plex_Sans_KR` (400/500/700)
- `app/page.tsx`: 인라인 style 정리, 진행 단계 `ol`, 이어하기 `ul`, 문구 정리. 상태·API 호출 로직은 그대로

## 리뷰 포인트
- `.kind label:has(:checked)` — `:has()` 미지원 브라우저에서는 선택 테두리만 빠지고 라디오는 정상 동작
- 모호도 섹션에 `style={{ "--pass": PASS }}` 로 기준선 위치를 엔진 상수와 맞춤
- `next/font/google` 은 빌드 시 폰트를 내려받음 (오프라인 빌드면 실패)

## 확인 방법
- [x] `npx tsc --noEmit`, `npm test` 10/10, `npm run build` 통과
- [x] 홈 · 인터뷰 대기 · 완료 화면 1440px, 홈 · 인터뷰 390px 캡처로 확인 (가로 스크롤 없음)
- [ ] 미리보기(수정 반영) 화면 직접 확인 — 해당 상태의 세션이 없어 캡처하지 못함

## 증거
[전후 리포트 보기](https://github.com/gyeolhwi/prd-interview/issues/9#issuecomment-7096934006)

## 관련
- 이슈: [#9 화면 디자인을 서비스 성격에 맞게 재정비하고 기본 템플릿 느낌 제거](https://github.com/gyeolhwi/prd-interview/issues/9) (통합 테스트 뒤 close)
- 커밋: 91eb19d 화면을 '문서를 채워 가는 도구' 모습으로 바꾸고 기본 템플릿 느낌을 걷어냄 - 2026-11-23
