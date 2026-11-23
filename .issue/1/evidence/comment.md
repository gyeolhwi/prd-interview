## 작업 요약

`answer()` 가 기다리던 질문을 깨우기만 하고 저장 전에 반환해서, POST 응답이 이전 `waiting` 상태를 돌려줬고 화면 폴링도 멈췄습니다.
이제 답을 기록·저장(`status: "running"`)한 뒤에 waiter 를 깨웁니다. 중복이던 `canUseTool` 쪽 기록·저장은 지웠습니다.

## 동작 비교

`lib/interview.test.ts` 회귀 테스트: 대기 중인 질문이 있을 때 `answer()` 를 호출한 직후 `session.json` 상태를 확인합니다.

| 지표 | 전 | 후 |
| --- | --- | --- |
| `answer()` 직후 저장된 status | `waiting` ✖ | `running` ✔ |
| 재클릭 시 | 409 (기록 안 됨) | 409 (중복 기록 안 됨, 이미 다음 단계로 진행 중) |
| `npm test` | 5/5 (새 테스트 없음) | 6/6 |

측정: `node --test --experimental-strip-types lib/interview.test.ts`. 결과가 결정적이라 1회만 돌렸습니다. 원본은 `.issue/1/evidence/before.txt`, `after.txt` 에 있습니다.

## 변경 파일

- `lib/interview.ts` — `answer()` 가 저장을 먼저 하고, `ask()` 의 `canUseTool` 에서 중복 기록 제거
- `lib/interview.test.ts` — 회귀 테스트 추가

## 검증

- `npm test` 6/6 통과
- `npx tsc --noEmit` 오류 없음
- 브라우저 실사용 재현은 미측정 (Claude 호출이 필요해 자동화하지 않음)

## 남은 이슈

- 같은 세션을 탭 두 개에서 동시에 답하면 겹칠 수 있음 (탭 하나에서는 `busy` 가 막음)
