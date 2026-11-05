// The lab curriculum. Text supports `code` and **bold**. Commands are written for PowerShell.
window.LABS = [
  {
    id: 'setup',
    title: 'Concepts & tooling',
    level: 'Basics', minutes: 20, cost: 'free',
    goal: 'Learn the vocabulary Elastic Beanstalk uses everywhere, install the CLIs and run this lab app on your machine.',
    concepts: [
      '**Application**: a folder-like container for everything below. Here it is `beanstalk-lab`.',
      '**Application version**: one deployable zip of your code, stored in an S3 bucket named `elasticbeanstalk-<region>-<account>`. Versions are immutable, and you can redeploy any of them.',
      '**Environment**: the running AWS resources (EC2 instances, an Auto Scaling group, and optionally a load balancer) running **one** version at a time. Every environment gets a URL like `name.region.elasticbeanstalk.com`.',
      '**Platform**: the OS plus runtime image, e.g. *Node.js 22 running on 64bit Amazon Linux 2023*. Beanstalk installs Node, nginx and its own agents for you.',
      '**Tier**: a *web server* environment serves HTTP. A *worker* environment pulls jobs from an SQS queue (Lab 15).',
      'Under the hood, every environment is a **CloudFormation stack**. Beanstalk is an opinionated layer over EC2, ASG, ELB, CloudWatch and S3. Nothing in it is magic, and you can find every resource in the console.'
    ],
    steps: [
      { t: 'Install the AWS CLI v2, then configure credentials for an IAM user or SSO profile with Elastic Beanstalk permissions (the `AdministratorAccess-AWSElasticBeanstalk` managed policy is enough for learning).', cmd: 'aws configure\naws sts get-caller-identity' },
      { t: 'Install the EB CLI (needs Python). Check that it works.', cmd: 'pip install awsebcli --upgrade --user\neb --version' },
      { t: 'Run the lab app locally from this folder.', cmd: 'npm install\nnpm start' },
      { t: 'Open http://localhost:8080. **Overview** says *Running locally*. Try the Chaos lab buttons locally: they work the same way, only without Beanstalk reacting.' },
      { t: 'Run the tests.', cmd: 'npm test' }
    ],
    gotchas: [
      'If `eb` is "not recognized" after pip install, add Python\'s user Scripts folder (shown in the pip output) to your PATH, or install with the official EB CLI setup script from GitHub (`aws/aws-elastic-beanstalk-cli-setup`).'
    ],
    verify: '`eb --version` prints a version, and the app runs at localhost:8080.'
  },
  {
    id: 'first-deploy',
    title: 'Your first deployment (single instance)',
    level: 'Basics', minutes: 25, cost: '1× t3.micro',
    goal: 'Create an application and a cheap single-instance environment, then deploy this app to it.',
    concepts: [
      '`eb init` only writes local config (`.elasticbeanstalk/config.yml`) and creates the application. It launches nothing.',
      '`eb create` builds an environment: security group, Auto Scaling group with 1 instance, Elastic IP (single-instance mode) and CloudWatch alarms.',
      'On deploy, Beanstalk unzips your bundle into `/var/app/staging`, runs `npm install` (because `node_modules` is not in the bundle), then moves it to `/var/app/current` and starts it with the command from `Procfile`.'
    ],
    steps: [
      { t: 'Initialise. Choose a region, name the application `beanstalk-lab`, pick the latest **Node.js** platform, and say **yes** to SSH (create a key pair). You need SSH in later labs.', cmd: 'eb init' },
      { t: 'Look at what it wrote.', cmd: 'Get-Content .elasticbeanstalk\\config.yml' },
      { t: 'Create a single-instance environment (no load balancer, cheapest). This takes about 5 minutes. Read the events as they stream.', cmd: 'eb create lab-dev --single -i t3.micro' },
      { t: 'Open it. Overview should now show an instance ID (`i-…`), availability zone and private IP.', cmd: 'eb open' },
      { t: 'Get to know the read-only commands.', cmd: 'eb status\neb events\neb health\neb list' },
      { t: 'In the AWS console, find the **same** things: the Beanstalk environment, its EC2 instance, the S3 bucket holding your zip, and the CloudFormation stack `awseb-e-…-stack`.' }
    ],
    gotchas: [
      'If `eb create` fails with an error about an **instance profile**, your account has no default EC2 role. Create an IAM role for EC2 named `aws-elasticbeanstalk-ec2-role` with the policies `AWSElasticBeanstalkWebTier`, `AWSElasticBeanstalkWorkerTier` and `AWSElasticBeanstalkMulticontainerDocker`, then run `eb create … --instance_profile aws-elasticbeanstalk-ec2-role`.',
      'This project has a `.ebignore` file, so the EB CLI zips your **working folder** (uncommitted changes included) and skips `node_modules`. Without `.ebignore` in a git repo, the EB CLI deploys only your **last commit**, which is a classic "why didn\'t my change deploy?" trap.',
      'The app must listen on `process.env.PORT` (default 8080). nginx proxies port 80 to it. Hard-code another port and you get 502s.'
    ],
    verify: 'Overview shows *Running on Elastic Beanstalk*, plus an instance ID and zone.'
  },
  {
    id: 'versions',
    title: 'Deploying & rolling back versions',
    level: 'Basics', minutes: 15, cost: '1× t3.micro',
    goal: 'Ship a change, give it a label, and roll back to an earlier version.',
    concepts: [
      'Every `eb deploy` uploads a new **application version** to S3, then tells the environment to run it.',
      'Rollback in Beanstalk means *deploying an older version*. Nothing is undone in place.',
      'Accounts have a quota on application versions per region. A **version lifecycle policy** deletes old ones automatically.'
    ],
    steps: [
      { t: 'Change `"version"` in `package.json` to `1.1.0`. The app displays this value.' },
      { t: 'Deploy with a label and a message.', cmd: 'eb deploy --label v1.1.0 --message "First change"' },
      { t: 'Refresh Overview: it says **v1.1.0**. List all versions in the application.', cmd: 'eb appversion' },
      { t: 'Roll back to the version `eb create` uploaded. Copy its label from the list above (or from Console → Application versions).', cmd: 'eb deploy --version <old-label>' },
      { t: 'In the console, open **Application versions → Settings** and turn on a lifecycle policy (for example, keep the 20 most recent).' }
    ],
    verify: 'You deployed v1.1.0, then went back to the original version with `--version`.'
  },
  {
    id: 'env-props',
    title: 'Environment properties & configuration precedence',
    level: 'Basics', minutes: 20, cost: '1× t3.micro',
    goal: 'Configure the app without changing code, and learn which setting wins when the same option is set in two places.',
    concepts: [
      'Environment properties are passed to your process as environment variables.',
      'Changing them is a **configuration update**. Beanstalk restarts the app (watch the PID on Overview change) but does not deploy a new version.',
      'Precedence, highest first: **settings applied directly** (console, `eb setenv`, `eb scale`) → **saved configurations** → **`.ebextensions`** → defaults.'
    ],
    steps: [
      { t: 'Set three properties. The app shows the greeting, recolours itself and reports `APP_VERSION` instead of the package version.', cmd: 'eb setenv GREETING="Hello from eb setenv" APP_COLOR=crimson APP_VERSION=2.0.0-env' },
      { t: 'Check them from the CLI, and in Overview → Environment variables.', cmd: 'eb printenv' },
      { t: 'Protect the chaos endpoints: set a lab key, then type the same key into the box at the top of the Chaos lab.', cmd: 'eb setenv LAB_KEY=pick-something-long' },
      { t: 'Now set the same options in code: copy the lab file into `.ebextensions` and deploy.', cmd: 'Copy-Item labs\\ebextensions\\env.config .ebextensions\\\neb deploy' },
      { t: 'Notice the colour is **still crimson**: the direct `eb setenv` value wins over `.ebextensions`. Remove the direct values, and the `.ebextensions` values (teal) take over.', cmd: 'eb setenv GREETING= APP_COLOR= APP_VERSION=' }
    ],
    gotchas: [
      'Environment properties are visible in plain text in the console and through the API. For real secrets, store them in **Secrets Manager** or **SSM Parameter Store** and give the instance role permission to read them.',
      'In `eb setenv`, an empty value (`NAME=`) **removes** the property.'
    ],
    verify: 'You saw `eb setenv` override `.ebextensions`, and the chaos endpoints answer 401 without the lab key.'
  },
  {
    id: 'logs',
    title: 'Logs: tail, bundle & CloudWatch',
    level: 'Basics', minutes: 20, cost: 'CloudWatch Logs (cents)',
    goal: 'Find your own log lines on the instance, download them, and stream them to CloudWatch Logs.',
    concepts: [
      'Everything your app prints to stdout/stderr ends up in `/var/log/web.stdout.log` on the instance.',
      'Other useful logs: `/var/log/nginx/access.log` and `error.log` (the proxy), and `/var/log/eb-engine.log` (what Beanstalk did during a deploy, and **the first place to look when a deploy fails**).',
      'This app logs one JSON object per line, which suits CloudWatch Logs Insights well.'
    ],
    steps: [
      { t: 'Chaos lab → **Write a log line** with an *info* line and an *error* line.' },
      { t: 'Get the last 100 lines of each log file, then find your message.', cmd: 'eb logs' },
      { t: 'Download the **full** log bundle (saved under `.elasticbeanstalk\\logs`).', cmd: 'eb logs --all' },
      { t: 'Stream logs to CloudWatch, then open the log group `/aws/elasticbeanstalk/lab-dev/var/log/web.stdout.log` in the console.', cmd: 'eb logs --cloudwatch-logs enable' },
      { t: 'In CloudWatch **Logs Insights**, run a query against that log group to find only the lab log lines:', cmd: 'fields @timestamp, @message\n| filter @message like /lab.log/\n| sort @timestamp desc' },
      { t: 'Optional: SSH in and look around (`eb ssh`, then `sudo tail -f /var/log/web.stdout.log`).', cmd: 'eb ssh' }
    ],
    gotchas: ['Streamed log groups are **kept after you terminate the environment** unless you choose otherwise. Delete them during cleanup.'],
    verify: 'You found your message in `eb logs` and in CloudWatch Logs.'
  },
  {
    id: 'health',
    title: 'Enhanced health monitoring',
    level: 'Basics', minutes: 20, cost: '1× t3.micro',
    goal: 'Watch Beanstalk change health status when your app misbehaves, and learn to read why.',
    concepts: [
      'Enhanced health combines instance metrics, nginx request stats (status codes, latency) and the health check URL into one status: **Ok/green**, **Warning/yellow**, **Degraded/red**, **Severe/red**, or **Info/grey/Pending/Unknown**.',
      'Each status comes with **causes**, e.g. *"95 % of requests are failing with HTTP 5xx"*.',
      'In this project, `.ebextensions/healthcheck.config` sets the health check URL to `/api/health`.'
    ],
    steps: [
      { t: 'In a second terminal, keep a live health view open.', cmd: 'eb health --refresh' },
      { t: 'Chaos lab → **Fire errors** (100). Within a minute, watch the 5xx percentage climb and the status turn red with a cause.' },
      { t: 'Wait for it to recover to Ok. Then try **Freeze the event loop** (30 s), followed by a few page refreshes: nginx returns **502/504** because Node stopped answering.' },
      { t: 'Find the same information in the console (Environment → Health) and in `eb events`.' }
    ],
    verify: 'You watched the status go red, read its cause, and saw it recover on its own.'
  },
  {
    id: 'crash',
    title: 'Crashes, OOM & self-healing',
    level: 'Basics', minutes: 15, cost: '1× t3.micro',
    goal: 'See how Beanstalk keeps your process alive, and what happens when memory runs out.',
    concepts: [
      'On Amazon Linux 2023, Beanstalk runs your Procfile command as a **systemd** service called `web`. systemd restarts it when it exits.',
      'This restarts the *process*. It doesn\'t replace the *instance*. Replacing broken instances is the Auto Scaling group\'s job (Lab 7).'
    ],
    steps: [
      { t: 'Note the **PID** and **uptime** on Overview. Chaos lab → **Crash now**. Refresh Overview within a few seconds: new PID, uptime reset.' },
      { t: 'Find the crash: look for `chaos.crash` and then `server.start`.', cmd: 'eb logs' },
      { t: 'Look at the service from the instance itself.', cmd: 'eb ssh\nsudo systemctl status web\nsudo journalctl -u web --since "15 min ago"' },
      { t: 'Memory: click **Allocate** (128 MB) repeatedly and watch Process RSS on Overview. On a t3.micro (1 GB), the Linux OOM killer ends the process (`dmesg | grep -i kill` over SSH), and systemd starts it again.' }
    ],
    verify: 'You crashed the app twice (once by exit, once by OOM) and it came back on its own both times.'
  },
  {
    id: 'load-balancer',
    title: 'Load-balanced environments & health checks',
    level: 'Intermediate', minutes: 30, cost: 'ALB + 2× t3.micro (~$1/day)',
    goal: 'Run several instances behind an Application Load Balancer and watch how traffic is spread out and taken away.',
    concepts: [
      'A load-balanced environment has an **ALB**, a **target group** that checks `/api/health`, and an **Auto Scaling group** (1–4 instances by default).',
      'The ALB sends traffic only to instances that pass the health check.',
      'By default the Auto Scaling group\'s health check type is **EC2**. It replaces an instance only if the VM itself fails, **not** when your app fails the ALB check.'
    ],
    steps: [
      { t: 'Create a second, load-balanced environment and switch the CLI to it.', cmd: 'eb create lab-lb --elb-type application -i t3.micro\neb use lab-lb' },
      { t: 'Run two instances.', cmd: 'eb scale 2' },
      { t: 'Open the app → **Deploy watcher** → Start. The *By instance* strip alternates between two instance IDs, and Overview → Request path now shows an `X-Forwarded-For` chain.', cmd: 'eb open' },
      { t: 'Chaos lab → health **Fail (503)** with *auto-revert 3 min*. Only the instance that answered fails. Within about 30 s, the watcher shows only the **other** instance. The ALB took the failing one out of rotation, and `eb health` shows it as Severe.' },
      { t: 'Note: you can\'t reach the failing instance through the ALB any more, so you can\'t click "Healthy" on it. That\'s why auto-revert exists. After 3 minutes it comes back.' },
      { t: 'Optional: copy `asg-elb-healthcheck.config` and deploy. Now a failing health check makes the ASG **terminate and replace** the instance. Fail one with auto-revert 0 and watch a new instance ID appear (it takes a few minutes).', cmd: 'Copy-Item labs\\ebextensions\\asg-elb-healthcheck.config .ebextensions\\\neb deploy' }
    ],
    gotchas: [
      'An ALB costs money every hour it exists, even with no traffic. Terminate `lab-lb` when you stop for the day (`eb terminate lab-lb`) and recreate it next time.',
      'Sticky sessions are off by default, so in-memory state (like the task list on the Worker page) differs per instance.'
    ],
    verify: 'The watcher showed two instances, then one, then two again.'
  },
  {
    id: 'autoscaling',
    title: 'Auto Scaling on CPU',
    level: 'Intermediate', minutes: 30, cost: 'ALB + up to 3× t3.micro',
    goal: 'Make the environment add instances under load and remove them afterwards.',
    concepts: [
      'Beanstalk creates CloudWatch alarms that drive scaling policies on the ASG. The `aws:autoscaling:trigger` options define the metric and the thresholds.',
      'EC2 basic monitoring sends CPU metrics every **5 minutes**, so scaling takes several minutes to react. That\'s normal.'
    ],
    steps: [
      { t: '`eb scale 2` set min = max = 2 **directly**, which overrides `.ebextensions`. Open the config editor and set `MinSize: 1` and `MaxSize: 3` under `aws:autoscaling:asg`, then save and close.', cmd: 'eb config' },
      { t: 'Add the CPU trigger and deploy.', cmd: 'Copy-Item labs\\ebextensions\\autoscaling.config .ebextensions\\\neb deploy' },
      { t: 'Chaos lab → **Burn CPU**: 2 cores (a t3.micro has 2 vCPUs), 900 s. Click it several times: each click lands on whichever instance the ALB picks.' },
      { t: 'Watch for the alarm firing and a new instance launching (5–10 minutes). The Deploy watcher shows a third instance ID appear.', cmd: 'eb health --refresh\neb events -f' },
      { t: 'Click **Stop** (or wait). After the low-CPU breach period, the ASG scales back in.' }
    ],
    gotchas: [
      't3 instances run on **CPU credits**. Burning for a long time drains them and the instance gets throttled, which is a real production surprise.',
      'Scaling in terminates an instance, along with anything stored only on its disk or in its memory. Treat instances as disposable.'
    ],
    verify: 'The instance count went up because of CPU, then back down.'
  },
  {
    id: 'deploy-policies',
    title: 'Deployment policies: all-at-once vs rolling vs immutable',
    level: 'Intermediate', minutes: 45, cost: 'ALB + 2–4× t3.micro',
    goal: 'Watch each deployment policy in the Deploy watcher, including what happens when a release is broken.',
    concepts: [
      '**AllAtOnce** (default): every instance at once. Fastest, but there is downtime, and a bad release breaks everything.',
      '**Rolling**: one batch at a time, so capacity drops during the deploy and versions are mixed.',
      '**RollingWithAdditionalBatch**: launches an extra batch first, so capacity stays full.',
      '**Immutable**: launches brand-new instances in a temporary ASG and swaps them in only if they\'re healthy. Safest, and rollback is fast.',
      '**TrafficSplitting**: a canary. A percentage of traffic goes to new instances for an evaluation period.'
    ],
    steps: [
      { t: 'Make sure you have 2 instances (`eb scale 2`). Open the **Deploy watcher** at 500 ms and click Start.' },
      { t: '**AllAtOnce**: change the `package.json` version to `3.0.0` and deploy. Watch the strip: errors (red) appear, then everything switches colour at once.', cmd: 'eb deploy' },
      { t: '**Rolling**: copy the policy file. Deploy once to apply it, then change the version to `3.1.0` and deploy again. Both versions answer side by side for a while, and you see one instance at a time disappear.', cmd: 'Copy-Item labs\\ebextensions\\deploy-rolling.config .ebextensions\\deploy.config\neb deploy' },
      { t: '**Immutable**: edit `.ebextensions\\deploy.config` and set `DeploymentPolicy: Immutable`. Deploy twice as above. Brand-new instance IDs appear, and then the old ones disappear.' },
      { t: '**Broken release**: add `throw new Error(\'Simulated bad release\');` as the first line of `server.js` and deploy with Immutable. The new instances fail health checks, Beanstalk terminates them, and **your old version never stops serving**. Remove the line afterwards.' },
      { t: 'Repeat the broken release with **AllAtOnce** to compare: the whole site goes down until you redeploy a good version (`eb deploy --version <label>`).' },
      { t: 'Advanced: try `deploy-traffic-splitting.config` and watch about 20 % of requests show the new colour for 5 minutes.' }
    ],
    gotchas: ['A deployment policy set in `.ebextensions` applies to **later** deployments, so deploy once to apply it before you judge the behaviour.'],
    verify: 'You can describe from memory, using the watcher strips, how AllAtOnce, Rolling and Immutable differ.'
  },
  {
    id: 'blue-green',
    title: 'Blue/green deployments with CNAME swap',
    level: 'Intermediate', minutes: 30, cost: '2 environments (temporarily)',
    goal: 'Run the next version in a separate environment and switch production traffic to it by swapping URLs.',
    concepts: [
      'Blue/green is **not** a deployment policy. It means two full environments plus `eb swap`, which swaps their CNAMEs (URLs).',
      'This is the right choice for risky changes such as a platform upgrade, a new instance type or VPC changes. Rollback is just swapping back.'
    ],
    steps: [
      { t: 'Clone the environment, including its configuration.', cmd: 'eb clone lab-lb -n lab-green' },
      { t: 'Make the clone visibly different and deploy a new version to it.', cmd: 'eb use lab-green\neb setenv APP_COLOR=seagreen\neb deploy' },
      { t: 'Open **lab-lb**\'s URL and start the Deploy watcher there. Then swap.', cmd: 'eb swap lab-lb -n lab-green' },
      { t: 'Watch the watcher switch to the green colour and new instance IDs, with no errors. It can take a minute because of DNS caching.' },
      { t: 'Swap back to roll back, or terminate the old environment once you\'re happy.', cmd: 'eb terminate lab-green' }
    ],
    gotchas: ['Clients and DNS resolvers cache the old record. Keep the old environment running until its traffic drops to zero before you terminate it.'],
    verify: 'Production traffic moved to the other environment without a single red square.'
  },
  {
    id: 'ebextensions',
    title: '.ebextensions deep dive',
    level: 'Advanced', minutes: 30, cost: 'any env',
    goal: 'Understand every section of an .ebextensions file and the order in which they run.',
    concepts: [
      'Files are `.ebextensions/*.config` in YAML or JSON, applied in **alphabetical order**.',
      'Sections: `option_settings`, `packages` (yum), `groups`, `users`, `sources`, `files`, `commands`, `services`, `container_commands` and `Resources` (raw CloudFormation).',
      '`commands` run **before** your app is extracted. `container_commands` run **after**, in the staging directory, so they can see your code and env vars.',
      '`leader_only: true` runs a command on just one instance. That suits database migrations.'
    ],
    steps: [
      { t: 'Read `labs/ebextensions/lab-markers.config`, then copy it in and deploy.', cmd: 'Copy-Item labs\\ebextensions\\lab-markers.config .ebextensions\\\neb deploy' },
      { t: 'Overview → **Lab markers**: you see the files written by `files`, `commands` and `container_commands`. With 2+ instances, refresh until you land on different instances: only one has `leader-only.txt`.' },
      { t: 'Break it on purpose: put a **tab** character in the YAML indentation and deploy. Read the error in `eb events` and `/var/log/eb-engine.log` (`eb logs`). Then fix it.' }
    ],
    gotchas: [
      'YAML must use spaces, never tabs, and Windows editors sometimes insert them.',
      'For things that run at deploy time, AWS now recommends **platform hooks** (next lab) over `commands`/`container_commands`. Use `.ebextensions` mainly for `option_settings` and `Resources`.'
    ],
    verify: 'Lab markers lists files from all three sections, and only one instance has the leader marker.'
  },
  {
    id: 'hooks',
    title: 'Platform hooks (.platform/hooks)',
    level: 'Advanced', minutes: 25, cost: 'any env',
    goal: 'Run your own scripts at exact points in the deployment lifecycle.',
    concepts: [
      '`.platform/hooks/prebuild`: after the bundle is extracted, before `npm install`.',
      '`.platform/hooks/predeploy`: after the build, before the app is moved to `/var/app/current`.',
      '`.platform/hooks/postdeploy`: after the new version is live.',
      '`.platform/confighooks/…`: the same stages, but they run on **configuration** changes (like `eb setenv`) rather than code deploys.',
      'Scripts in each folder run in alphabetical order, as root.'
    ],
    steps: [
      { t: 'Copy the hooks into place and deploy.', cmd: 'New-Item -ItemType Directory -Force .platform | Out-Null\nCopy-Item -Recurse labs\\platform\\hooks .platform\\\neb deploy' },
      { t: 'Overview → Lab markers shows `predeploy-hook.txt` and `postdeploy-hook.txt`.' },
      { t: 'If they\'re missing, read `/var/log/eb-engine.log` and `/var/log/eb-hooks.log` (`eb logs`).' },
      { t: 'Run `eb setenv GREETING=hooks-test`. The hooks do **not** run, because a config change runs `confighooks` instead. Copy the predeploy script into `.platform\\confighooks\\predeploy\\`, deploy, and try again.' }
    ],
    gotchas: [
      'Scripts need **LF line endings**. With CRLF you get `/bin/bash^M: bad interpreter`. This repo\'s `.gitattributes` forces LF. In VS Code, check the CRLF/LF indicator in the status bar.',
      'Scripts need **execute permission**. Zips built on Windows can lose it. If the logs show "permission denied", deploy from a git repo and mark the files executable: `git update-index --chmod=+x .platform/hooks/*/*.sh`.'
    ],
    verify: 'Both hook markers appear, and you know why `eb setenv` didn\'t trigger them.'
  },
  {
    id: 'nginx',
    title: 'Customising nginx',
    level: 'Advanced', minutes: 20, cost: 'any env',
    goal: 'Change the reverse proxy that sits in front of Node.js.',
    concepts: [
      '`.platform/nginx/conf.d/*.conf` is included at the **http** level, which suits global settings like `client_max_body_size`.',
      '`.platform/nginx/conf.d/elasticbeanstalk/*.conf` is included **inside the default server block**, which suits extra `location` blocks.',
      '`.platform/nginx/nginx.conf` **replaces** the whole default config. Avoid it unless you copy the default first.'
    ],
    steps: [
      { t: 'Before the change, try uploading something over 1 MB, or just note that Overview → *Customization checks* says `/nginx-lab` is "not yet".' },
      { t: 'Copy the nginx config and deploy.', cmd: 'New-Item -ItemType Directory -Force .platform | Out-Null\nCopy-Item -Recurse labs\\platform\\nginx .platform\\\neb deploy' },
      { t: 'Overview → Customization checks turns green: nginx answers `/nginx-lab` itself, and the request never reaches Node.' },
      { t: 'SSH in and check the merged config.', cmd: 'eb ssh\nsudo nginx -T | less' }
    ],
    gotchas: ['If the nginx config is invalid, the deploy fails. `sudo nginx -t` over SSH tells you why.'],
    verify: '`/nginx-lab` returns "hello from nginx on <hostname>".'
  },
  {
    id: 'database',
    title: 'Databases: RDS, coupled vs decoupled',
    level: 'Advanced', minutes: 40, cost: 'RDS db.t3/t4g.micro (free tier or ~$0.5/day)',
    goal: 'Connect the environment to a database the right way and debug the most common failure: security groups.',
    concepts: [
      '**Coupled**: you add RDS from the environment\'s configuration. Beanstalk creates it and sets `RDS_HOSTNAME`, `RDS_PORT`, `RDS_DB_NAME`, `RDS_USERNAME` and `RDS_PASSWORD`. But **its lifecycle is tied to the environment**: terminate the environment and the database goes with it, unless you keep a snapshot.',
      '**Decoupled** (recommended for anything real): you create RDS yourself and pass the connection details as environment properties. Blue/green swaps and rebuilds don\'t touch your data.',
      'Connectivity requires the database\'s **security group** to allow inbound traffic on the DB port **from the environment\'s instance security group**.'
    ],
    steps: [
      { t: 'Create a PostgreSQL or MySQL database in the RDS console: free-tier template, same VPC as your environment, **not** publicly accessible.' },
      { t: 'Point the app at it **before** opening any ports.', cmd: 'eb setenv DB_HOST=<rds-endpoint> DB_PORT=5432 DB_NAME=postgres' },
      { t: 'Worker & DB → **Check database**. Expect a **timeout**. That is the security group blocking you.' },
      { t: 'In EC2 → Security Groups, find the environment\'s group (`awseb-e-…-AWSEBSecurityGroup…`). Edit the **database\'s** security group: add an inbound rule for port 5432 (or 3306) with that security group as the **source**.' },
      { t: 'Check again: **Reachable**. You\'ve just fixed the most common Beanstalk database problem.' },
      { t: 'Optional: try the coupled way on `lab-dev` (Configuration → Database), see the `RDS_*` variables appear in Overview, and read the warning about deletion.' }
    ],
    gotchas: ['RDS charges by the hour. Delete the database (and its snapshots) when you finish.'],
    verify: 'The check went from timeout to reachable because of a security group rule you added.'
  },
  {
    id: 'worker',
    title: 'Worker environments, SQS & cron.yaml',
    level: 'Advanced', minutes: 40, cost: '1× t3.micro + SQS (cents)',
    goal: 'Process background jobs from a queue, see retries and dead-letter queues, and schedule periodic tasks.',
    concepts: [
      'A worker environment has **no public URL**. It has an SQS queue, and the **SQS daemon (sqsd)** on each instance POSTs every message to your app at `http://localhost/<HttpPath>`.',
      'Return **200** and the message is deleted. Any other status (or a timeout) means the message comes back after the visibility timeout and is retried. After too many attempts it goes to the **dead-letter queue**.',
      '`cron.yaml` in the bundle root makes the leader worker POST to a URL on a schedule.'
    ],
    steps: [
      { t: 'Try it locally first: Worker & DB → **Simulate an SQS message**, with and without `FAIL` in the body.' },
      { t: 'Add the worker settings and the cron file, then create a worker environment.', cmd: 'Copy-Item labs\\ebextensions\\worker.config .ebextensions\\\nCopy-Item labs\\worker\\cron.yaml .\neb create lab-worker --tier worker -i t3.micro' },
      { t: 'Find the queue Beanstalk created (named `awseb-e-…-AWSEBWorkerQueue-…`) and send a message.', cmd: 'aws sqs list-queues\naws sqs send-message --queue-url <queue-url> --message-body "hello from SQS"' },
      { t: 'There\'s no URL to open, so use the logs: look for `worker.task` with `fromSqsd: true`.', cmd: 'eb logs' },
      { t: 'Send a message containing `FAIL`. In the logs, `receiveCount` goes up on each retry. In the SQS console, it eventually lands in the dead-letter queue.', cmd: 'aws sqs send-message --queue-url <queue-url> --message-body "please FAIL"' },
      { t: 'Every 5 minutes, a `worker.task` entry with `kind: cron` and `taskName: lab-heartbeat` appears, coming from `cron.yaml`.' },
      { t: 'Cleanup: terminate the worker, then remove `cron.yaml` and `worker.config` from the project.', cmd: 'eb terminate lab-worker\nRemove-Item cron.yaml, .ebextensions\\worker.config' }
    ],
    gotchas: [
      'The instance profile needs the `AWSElasticBeanstalkWorkerTier` policy, or sqsd can\'t read the queue.',
      'Only use `worker.config` for worker environments. Its `aws:elasticbeanstalk:sqsd` namespace is meaningless in a web environment.'
    ],
    verify: 'You saw a real SQS message, a retried failure and a cron task in the logs.'
  },
  {
    id: 'https',
    title: 'HTTPS & a custom domain',
    level: 'Advanced', minutes: 40, cost: 'needs a domain you own',
    goal: 'Serve the environment on your own domain over HTTPS, with TLS ending at the load balancer.',
    concepts: [
      'The certificate comes from **AWS Certificate Manager** (free) and is attached to an ALB **listener** on port 443.',
      'The ALB decrypts and forwards plain HTTP to the instances, and sets `X-Forwarded-Proto: https`. You can see it in Overview → Request path.',
      'Single-instance environments have no ALB, so HTTPS there means configuring nginx with a certificate yourself.'
    ],
    steps: [
      { t: 'Request a public certificate in ACM (in the **same region** as the environment) for `lab.yourdomain.com` and validate it through DNS.' },
      { t: 'Open the config editor and add a 443 listener under the `aws:elbv2:listener:443` namespace, with `Protocol: HTTPS` and `SSLCertificateArns: <certificate-arn>`.', cmd: 'eb use lab-lb\neb config' },
      { t: 'Point your domain at the environment: in Route 53 use an **alias A record** to the environment; with other DNS providers use a CNAME to the `…elasticbeanstalk.com` URL.' },
      { t: 'Open `https://lab.yourdomain.com`: Overview → Request path shows `X-Forwarded-Proto: https`.' },
      { t: 'Optional: redirect HTTP to HTTPS with an nginx `location` block or ALB listener rules.' }
    ],
    verify: 'The lab app loads on your domain over HTTPS.'
  },
  {
    id: 'operate',
    title: 'Saved configs, platform updates & cleanup',
    level: 'Advanced', minutes: 30, cost: 'saves money',
    goal: 'Recreate environments in a repeatable way, keep the platform patched, and tear everything down cleanly.',
    concepts: [
      'A **saved configuration** is a snapshot of an environment\'s settings, stored in S3. You can create new environments from it.',
      '**Managed platform updates** apply patch and minor platform updates during a weekly maintenance window, using immutable deployments.',
      'Platform **branches** (e.g. Node.js 20 → 22) retire on a schedule. Major upgrades are best done with blue/green.'
    ],
    steps: [
      { t: 'Save the load-balanced environment\'s configuration and rebuild a copy from it.', cmd: 'eb config save lab-lb --cfg lab-baseline\neb create lab-copy --cfg lab-baseline' },
      { t: 'See which platform you\'re on and which versions are available, then upgrade.', cmd: 'eb status\neb platform list\neb upgrade' },
      { t: 'In the console: Configuration → **Updates, monitoring and logging** → turn on managed platform updates.' },
      { t: 'Cleanup. Terminate each environment, or delete everything including the application.', cmd: 'eb terminate lab-copy\neb terminate lab-lb\neb terminate lab-dev\n# or everything, including the application:\neb terminate --all' },
      { t: 'Check for leftovers: the S3 bucket `elasticbeanstalk-<region>-<account>`, CloudWatch log groups `/aws/elasticbeanstalk/…`, RDS databases and snapshots, and the ACM certificate.' }
    ],
    verify: 'You rebuilt an environment from a saved config, and your AWS bill shows nothing still running.'
  }
];
