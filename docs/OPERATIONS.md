# Note10 서버 운영 가이드

## 서버 정보

- 장치: Samsung Galaxy Note10
- 환경: Android + Termux
- 네트워크: Tailscale
- Termux 사용자: `u0_a318`
- SSH 포트: `8022`

Tailscale IP는 Tailscale 앱에서 확인한다.

## 서비스

| 서비스        | 포트 | 주소                                   |
| ------------- | ---: | -------------------------------------- |
| 개인 대시보드 | 8000 | `http://TAILSCALE_IP:8000`             |
| NAS           | 8000 | `http://TAILSCALE_IP:8000/nas.html`    |
| 서버 상태     | 8000 | `http://TAILSCALE_IP:8000/system.html` |
| code-server   | 8080 | `http://TAILSCALE_IP:8080`             |
| SSH/SFTP      | 8022 | `TAILSCALE_IP:8022`                    |

## 주요 경로

```text
~/projects/note10-personal-server
  개발용 Git 저장소

~/apps/myserver
  운영 서버

~/storage/shared/NAS
  NAS 데이터

~/.termux/boot/start-server
  부팅 및 서비스 시작 스크립트

~/.config/code-server/config.yaml
  code-server 설정

~/.config/rclone/rclone.conf
  Google Drive 및 암호화 설정
```

## 비밀정보 관리

실제 비밀번호, 인증 URL, 암호화 키는 Git 저장소에 기록하지 않는다.

| 항목                   | 저장 위치                                |
| ---------------------- | ---------------------------------------- |
| 운영 서버 계정         | `~/apps/myserver/.env`                   |
| 개발 환경 계정         | `~/projects/note10-personal-server/.env` |
| code-server 인증       | `~/.config/code-server/config.yaml`      |
| rclone 및 Google Drive | `~/.config/rclone/rclone.conf`           |
| Healthchecks Ping URL  | `~/.config/myserver/healthchecks.env`    |
| SSH 개인키             | 접속하는 PC의 사용자 `.ssh` 폴더         |

비밀 설정 파일의 권한은 소유자만 읽고 쓸 수 있도록 유지한다.

```bash
chmod 600 \
  ~/apps/myserver/.env \
  ~/projects/note10-personal-server/.env \
  ~/.config/code-server/config.yaml \
  ~/.config/rclone/rclone.conf \
  ~/.config/myserver/healthchecks.env
```

다음 값은 별도의 비밀번호 관리자에 보관한다.

- 서버 사용자명과 비밀번호
- code-server 비밀번호
- SSH 개인키 암호
- rclone crypt 비밀번호와 salt
- Healthchecks Ping URL

`.env`, 데이터베이스, 로그, 백업 파일은 GitHub에 커밋하지 않는다.

## 개발 및 배포

개발 작업은 Git 저장소에서 수행한다.

```bash
cd ~/projects/note10-personal-server
```

변경 후 로컬 검사를 실행한다.

```bash
node --check server.js
node --check auth.js
node --check nas.js
node --check system.js
npm test
git diff --check
```

검사가 통과하면 GitHub에 반영한다.

```bash
git add .
git commit -m "변경 내용"
git push
```

운영 서버에는 배포 스크립트로 반영한다.

```bash
./scripts/deploy.sh
```

배포가 성공하면 마지막에 다음 문구가 출력된다.

```text
Deployment completed successfully.
```

서버 재시작 직후 첫 상태 검사에서 `fetch failed`가 잠깐 표시될 수 있다. 이후 상태 JSON과 성공 문구가 나오면 정상이다.

배포 스크립트는 다음 작업을 수행한다.

1. Git 작업 트리 상태 확인
2. 최신 코드 가져오기
3. 배포 전 데이터베이스 백업
4. Node.js 의존성 설치
5. 운영 경로에 코드 복사
6. 서버 재시작 및 상태 검사

## 자료 본문 검색

자료실에 등록한 NAS 파일의 내용을 SQLite FTS5 검색 인덱스에 저장하여 검색할 수 있다.

PDF 본문 추출에는 Termux의 `poppler` 패키지가 필요하다.

```bash
pkg install poppler
pdftotext -v
```

자료실 화면에서 각 자료의 `본문 색인` 버튼을 누르면 파일 내용이 색인된다. 색인이 완료된 후 검색 방식을 `파일 본문 검색`으로 변경하여 검색한다.

지원하는 주요 형식:

- PDF: `.pdf`
- 문서: `.txt`, `.md`, `.markdown`, `.csv`
- 웹: `.html`, `.css`, `.js`, `.json`
- 설정: `.yml`, `.yaml`
- 소스코드: `.sh`, `.py`, `.java`, `.c`, `.cpp` 등

한 파일의 색인 크기는 최대 25MB이며, 추출된 본문은 최대 2,000,000자까지 저장한다.

검색 인덱스 기본 경로:

```text
~/apps/myserver/data/search-index.db
```

검색 인덱스는 NAS 파일에서 다시 생성할 수 있는 파생 데이터이므로 Google Drive 백업 대상에 포함하지 않는다. 검색 인덱스가 삭제되거나 손상되면 자료실에서 `본문 색인`을 다시 실행한다.

자료의 실제 파일 내용이 변경된 경우에도 본문 색인을 다시 실행해야 한다. 자료 등록정보를 삭제하면 해당 자료의 검색 색인도 함께 삭제된다.

## 스마트폰 상태 대시보드

서버 상태 화면에서 Note10의 배터리 잔량, 충전 상태, 연결 방식, 배터리 건강 상태와 온도를 확인할 수 있다.

이 기능에는 Termux 명령 패키지와 Android용 Termux:API 앱이 모두 필요하다.

```bash
pkg install termux-api
termux-battery-status
```

Termux:API 앱은 현재 사용하는 Termux와 같은 배포처에서 설치해야 한다. F-Droid와 GitHub 등 서로 다른 출처의 앱을 혼합하면 서명이 달라 연동되지 않을 수 있다.

Termux:API가 설치되지 않았거나 응답하지 않더라도 웹 서버와 기존 시스템 상태 기능은 계속 동작하며, 대시보드에는 `사용 불가`로 표시된다.

서버 상태 화면은 30초마다 자동으로 갱신된다.

## 자동 작업

Termux의 `crond`가 다음 작업을 실행한다.

| 시각       | 작업                             | 스크립트                      |
| ---------- | -------------------------------- | ----------------------------- |
| 5분마다    | 서버 및 code-server 자동 복구    | `~/.termux/boot/start-server` |
| 5분마다    | 서버 상태 확인 및 외부 생존 신호 | `check-server-health.sh`      |
| 매시 15분  | 저장공간 사용률 확인             | `check-storage.sh`            |
| 매일 03:30 | DB 및 NAS 암호화 백업            | `run-backup-monitored.sh`     |
| 매일 04:00 | 30일 지난 휴지통 정리            | `cleanup-trash.sh`            |
| 매일 04:05 | 90일 지난 NAS 이전 버전 정리     | `cleanup-nas-history.sh`      |
| 매일 04:10 | 5MB 이상 로그 회전               | `rotate-logs.sh`              |

현재 일정을 확인한다.

```bash
crontab -l
```

cron 프로세스가 실행 중인지 확인한다.

```bash
pgrep -af crond
```

## 로그 확인

| 로그                | 내용                       |
| ------------------- | -------------------------- |
| `server.log`        | Node.js 서버 실행 기록     |
| `code-server.log`   | code-server 실행 기록      |
| `backup.log`        | 로컬 및 클라우드 백업 결과 |
| `watchdog.log`      | 서비스 자동 복구 기록      |
| `healthcheck.log`   | 서버 생존 확인 결과        |
| `storage-check.log` | 저장공간 확인 결과         |
| `trash-cleanup.log` | 휴지통 자동 정리 결과      |
| `log-rotation.log`  | 로그 회전 결과             |

최근 로그는 다음 명령으로 확인한다.

```bash
tail -n 50 ~/apps/myserver/logs/파일명.log
```

로그 파일은 5MB를 넘으면 회전하며 이전 로그 3개까지 보관한다.

## 백업 확인

백업은 매일 03:30에 자동 실행된다.

수동으로 전체 백업을 실행하려면 다음 명령을 사용한다.

```bash
~/apps/myserver/scripts/run-backup-monitored.sh
```

최신 로컬 DB 백업을 확인한다.

```bash
ls -lht ~/apps/myserver/backups
```

Google Drive의 암호화된 DB 백업을 확인한다.

```bash
rclone lsl gcrypt:Database
```

Google Drive의 암호화된 NAS 백업을 확인한다.

```bash
rclone lsf gcrypt:NAS --recursive
```

로컬 DB 백업은 14일, 클라우드 DB 백업은 90일 동안 보관한다. NAS의 `.Trash` 폴더는 클라우드 백업에서 제외한다.

## DB 복구

먼저 복구할 클라우드 백업 파일명을 확인한다.

```bash
rclone lsl gcrypt:Database
```

원본 DB를 건드리지 않고 시험 폴더로 내려받는다. 아래 파일명은 실제 복구할 백업 이름으로 변경한다.

```bash
mkdir -p ~/restore-test

rclone copyto \
  gcrypt:Database/server-YYYYMMDD-HHMMSS.db \
  ~/restore-test/server.db
```

복구 파일의 무결성을 확인한다.

```bash
sqlite3 ~/restore-test/server.db \
  "PRAGMA integrity_check;"

sqlite3 ~/restore-test/server.db \
  ".tables"
```

`integrity_check` 결과가 `ok`이고 필요한 테이블이 표시될 때만 실제 복구를 진행한다.

서버를 중단한다.

```bash
tmux kill-session -t myserver
```

현재 DB를 별도로 보존한다.

```bash
cp \
  ~/apps/myserver/data/server.db \
  ~/apps/myserver/data/server.db.before-restore
```

검증한 DB를 운영 위치에 적용한다.

```bash
cp \
  ~/restore-test/server.db \
  ~/apps/myserver/data/server.db

chmod 600 ~/apps/myserver/data/server.db
```

서버를 다시 시작하고 상태를 확인한다.

```bash
~/.termux/boot/start-server

curl -u 서버사용자명 \
  http://127.0.0.1:8000/health
```

복구가 확인된 후에만 시험 폴더를 삭제한다.

## NAS 복구 시험

클라우드 NAS 백업을 별도 폴더로 내려받는다.

```bash
mkdir -p ~/nas-restore-test

rclone copy \
  gcrypt:NAS \
  ~/nas-restore-test
```

파일을 확인한다.

```bash
find ~/nas-restore-test -type f
```

복구본을 확인한 뒤 필요한 파일만 원래 NAS 경로로 복사한다. 기존 NAS 전체를 검증 없이 덮어쓰지 않는다.

## 장애 대응

### 웹 서버에 접속되지 않을 때

tmux 세션과 Node.js 프로세스를 확인한다.

```bash
tmux list-sessions
pgrep -af 'node.*server.js'
```

로컬 상태 확인:

```bash
curl -u 서버사용자명 \
  http://127.0.0.1:8000/health
```

서버 로그 확인:

```bash
tail -n 100 \
  ~/apps/myserver/logs/server.log
```

서버를 다시 시작한다.

```bash
tmux kill-session -t myserver 2>/dev/null || true
~/.termux/boot/start-server
```

### code-server에 접속되지 않을 때

프로세스와 로그를 확인한다.

```bash
pgrep -af code-server

tail -n 100 \
  ~/apps/myserver/logs/code-server.log
```

code-server 세션만 다시 시작한다.

```bash
tmux kill-session -t code-server 2>/dev/null || true
~/.termux/boot/start-server
```

### SSH에 접속되지 않을 때

Termux에서 SSH 서버를 확인하고 다시 실행한다.

```bash
pgrep -af sshd
sshd
```

PC에서 다음 주소로 접속한다.

```text
u0_a318@TAILSCALE_IP
포트: 8022
```

### Tailscale 연결이 끊겼을 때

1. 노트10의 Tailscale 앱이 연결 상태인지 확인한다.
2. Android 배터리 설정이 `제한 없음`인지 확인한다.
3. 노트10과 접속 기기가 같은 Tailnet에 로그인했는지 확인한다.
4. Tailscale 앱에 표시된 현재 IP를 다시 확인한다.

### 백업이 실패할 때

최근 백업 로그를 확인한다.

```bash
tail -n 100 \
  ~/apps/myserver/logs/backup.log
```

Google Drive 연결을 확인한다.

```bash
rclone lsd gcrypt:
```

백업을 수동으로 다시 실행한다.

```bash
~/apps/myserver/scripts/run-backup-monitored.sh
```

### 저장공간 경고가 발생했을 때

현재 사용량을 확인한다.

```bash
df -h ~/storage/shared/NAS
```

큰 파일을 확인한다.

```bash
du -ah ~/storage/shared/NAS |
sort -h |
tail -n 30
```

파일을 삭제하기 전 Google Drive 백업 여부를 먼저 확인한다.

### 외부 감시 상태 확인

```bash
~/apps/myserver/scripts/check-server-health.sh
~/apps/myserver/scripts/check-storage.sh
```

Healthchecks Ping URL은 출력하거나 GitHub에 기록하지 않는다.

## NAS 동기화 및 이전 버전

NAS 원본 경로:

```text
~/storage/shared/NAS
```

Google Drive 암호화 원격 저장소:

```text
gcrypt:NAS
```

NAS는 `rclone sync`로 동기화한다. 휴대폰에서 수정되거나 삭제된 파일의 기존 클라우드 버전은 즉시 제거하지 않고 다음 경로에 보관한다.

```text
gcrypt:NAS-History/YYYYMMDD-HHMMSS
```

보관 정책:

- 현재 NAS 파일은 기간 제한 없이 유지
- NAS 이전 버전은 90일간 유지
- 로컬 NAS 휴지통은 30일간 유지
- 한 번의 동기화에서 50개를 초과하여 삭제하려 하면 작업 중단

이전 버전 목록 확인:

```bash
rclone lsf gcrypt:NAS-History --recursive
```

정리 작업 미리 보기:

```bash
~/apps/myserver/scripts/cleanup-nas-history.sh --dry-run
```

90일이 지난 이전 버전 실제 정리:

```bash
~/apps/myserver/scripts/cleanup-nas-history.sh --apply
```

자동 정리는 매일 오전 4시 5분에 실행된다.

## 클라우드 DB 복원 점검

클라우드 백업 목록 확인:

```bash
rclone lsl gcrypt:Database
```

운영 DB를 건드리지 않고 최신 백업을 임시 경로에서 검사:

```bash
RESTORE_DIR="$(mktemp -d)"
LATEST_DB="$(rclone lsf gcrypt:Database | grep '^server-.*\.db$' | sort | tail -n 1)"

rclone copyto \
  "gcrypt:Database/$LATEST_DB" \
  "$RESTORE_DIR/restored.db"

sqlite3 "$RESTORE_DIR/restored.db" "PRAGMA integrity_check;"
sqlite3 "$RESTORE_DIR/restored.db" \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

정상 기준:

- 무결성 검사 결과가 `ok`
- 테이블 목록에 `notes`가 표시됨

검사 후 임시 파일 정리:

```bash
rm -f "$RESTORE_DIR/restored.db"
rmdir "$RESTORE_DIR"
```

운영 DB를 실제로 복원할 때는 서버를 먼저 중지하고 기존 DB를 별도로 보관한 후 진행한다.
