## 요약
딱딱하고 각져 보이던 화면을 부드럽게 바꾸고, 아이디어 입력칸을 넉넉하고 쓰기 편한 작성 상자로 바꿨습니다. 쓰는 방법은 그대로입니다.

## 달라지는 점
- 흰 시트·선택지·버튼 모서리가 둥글어지고, 굵은 상단 선 대신 옅은 그림자로 시트를 띄움
- 아이디어 입력칸이 크고 편해짐: 연한 배경, 큰 글자, 시작 버튼이 상자 안에 있고, 쓰는 중엔 남색 테두리와 노란 빛이 둘림
- 진행 단계·모호도 막대가 둥근 막대로, 이어하기 목록이 흰 카드로

## 왜
#9 디자인이 모서리 4px·굵은 상단 선·얇은 테두리 때문에 딱딱하고 각져 보였고, 입력칸이 좁고 밋밋했습니다.

## 구현
- `app/globals.css`: `--well` `--marker-soft` `--lift` 토큰, `.card` `.option` `.kind` `button` 모서리·여백, `.composer` `.composer-foot` 신설(`field-sizing: content`), 입력 요소 `:focus-visible` outline 을 자체 테두리·링으로 대체, `.steps .step::before` 둥근 막대
- `app/page.tsx`: 홈 입력칸을 `.composer` 로 감싸고 시작 버튼·안내 문구·오류를 `.composer-foot` 에 배치

## 리뷰 포인트
- `textarea/input:focus-visible { outline: none }` — 대신 `.composer:focus-within` 과 `input:focus` 의 테두리·링으로 포커스가 보이는지
- `field-sizing: content` 미지원(Safari·Firefox)에서는 고정 높이 + 스크롤로 동작

## 확인 방법
- [x] `npx tsc --noEmit`, `npm test` 10/10, `npm run build` 통과
- [x] 홈 · 인터뷰 · 완료 1440px, 홈 390px, 입력 중(포커스) 캡처로 확인
- [ ] 브라우저에서 입력칸에 직접 써 보기

## 증거
[전후 리포트 보기](https://github.com/gyeolhwi/prd-interview/issues/11#issuecomment-7104904894)

## 관련
- 이슈: [#11 디자인이 딱딱하고 각져 보이고 아이디어 입력칸이 답답함](https://github.com/gyeolhwi/prd-interview/issues/11) (통합 테스트 뒤 close)
- 커밋: 9e5418c UX(ui): 화면 인상을 부드럽게 바꾸고 아이디어 입력칸을 넉넉한 작성 상자로 - 2026-11-24
