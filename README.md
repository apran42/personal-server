# Note10 Personal Server

갤럭시 노트10과 Termux를 이용한 개인용 개발·NAS 서버입니다.

## 현재 기능

- Tailscale 사설망 접속
- SSH 및 SFTP
- 브라우저 기반 code-server
- Express 메모 API
- SQLite 데이터 저장
- 웹 메모 대시보드
- 기본 인증
- 자동 실행
- 데이터베이스 자동 백업

## 서비스 주소

Tailscale에 연결된 기기에서만 접근할 수 있습니다.

- 개인 대시보드: `http://100.86.150.102:8000`
- 개발 IDE: `http://100.86.150.102:8080`

## 실행

```bash
npm ci
cp .env.example .env
npm start