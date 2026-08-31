// pm2 설정 — Mac mini 운영용 (크래시 자동 재시작, pm2 startup 으로 부팅 시 기동).
// 비밀은 ~/.finance/env 에서 --env-file 로 읽는다. 이 파일은 커밋되므로 어떤 비밀도 넣지 않는다.
// DEV_EMAIL 은 여기에도 env 파일에도 절대 넣지 않는다 (로그인 우회).
const os = require('node:os');
const path = require('node:path');

module.exports = {
  apps: [{
    name: 'finance',
    script: 'server/index.js',
    cwd: __dirname,
    node_args: [
      '--disable-warning=ExperimentalWarning',
      // ~ 는 Node·pm2 가 풀어주지 않으므로 홈 경로를 직접 조립한다. 파일이 없으면 기동 실패 = 만들라는 신호.
      '--env-file=' + path.join(os.homedir(), '.finance', 'env'),
    ],
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 20,
    kill_timeout: 3000, // SIGINT 후 3초 안에 안 내려가면 SIGKILL (index.js 의 shutdown 폴백과 같은 값)
    time: true,         // 로그에 타임스탬프
  }],
};
