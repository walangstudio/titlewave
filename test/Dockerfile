FROM node:24-bookworm
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    tmux screen jq python3 python3-venv xvfb xterm kitty alacritty rxvt-unicode \
    x11-utils libgl1-mesa-dri libgl1 libegl1 libglx-mesa0 libxcursor1 libxi6 \
    ca-certificates curl bzip2 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.170.0 @anthropic-ai/claude-code@2.1.328 \
    @google/gemini-cli@0.69.0 @earendil-works/pi-coding-agent@0.80.2 opencode-ai@1.19.6 \
    && node /usr/local/lib/node_modules/@anthropic-ai/claude-code/install.cjs \
    && node /usr/local/lib/node_modules/opencode-ai/postinstall.mjs
RUN curl -fLsS https://github.com/aaif-goose/goose/releases/download/v1.60.1/goose-x86_64-unknown-linux-gnu.tar.bz2 -o /tmp/goose.tar.bz2 \
    && tar -xjf /tmp/goose.tar.bz2 -C /usr/local/bin \
    && curl -fLsS https://github.com/zellij-org/zellij/releases/download/v0.46.0/zellij-no-web-x86_64-unknown-linux-musl.tar.gz -o /tmp/zellij.tar.gz \
    && tar -xzf /tmp/zellij.tar.gz -C /usr/local/bin \
    && rm /tmp/goose.tar.bz2 /tmp/zellij.tar.gz
WORKDIR /work
COPY . .
CMD ["bash", "test/container.sh"]
