# Note10 서버 운영 가이드

## 서버 정보

- 장치: Samsung Galaxy Note10
- 환경: Android + Termux
- 네트워크: Tailscale
- Termux 사용자: `u0_a318`
- SSH 포트: `8022`

Tailscale IP는 Tailscale 앱에서 확인한다.

## 서비스

| 서비스 | 포트 | 주소 |
|---|---:|---|
| 개인 대시보드 | 8000 | `http://TAILSCALE_IP:8000` |
| NAS | 8000 | `http://TAILSCALE_IP:8000/nas.html` |
| 서버 상태 | 8000 | `http://TAILSCALE_IP:8000/system.html` |
| code-server | 8080 | `http://TAILSCALE_IP:8080` |
| SSH/SFTP | 8022 | `TAILSCALE_IP:8022` |

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