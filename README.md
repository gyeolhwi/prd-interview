# prd-interview

아이디어 한두 줄 → 단계별 질문(문제→사람→장면→핵심→경계→확인) → Pre-PRD 한 장(`data/<id>/pre-prd.md`).
기획 문서: [docs/pre-prd.md](docs/pre-prd.md)

```bash
npm install
npm run auth-check   # API 키 없이 로컬 Claude 로그인으로 Agent SDK가 도는지 확인
npm run dev          # http://localhost:3000
npm test             # 단계 엔진 규칙 테스트
```

- 인증: `ANTHROPIC_API_KEY` 없이 로컬 Claude Code 로그인(구독)을 쓴다. 안 되면 `claude setup-token` 후 `CLAUDE_CODE_OAUTH_TOKEN`을 설정한다.
- 1인 localhost 전용이다. 공유·배포할 때는 API 키 방식으로 바꿔야 한다.
- 중간 상태는 `data/<id>/session.json`에 저장되어, 닫았다 열어도 이어서 진행한다.
