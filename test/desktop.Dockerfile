FROM archlinux@sha256:d4594bb2300cba11f41c2f27923eb56f63d9988909c402f9c95517d1e362c899
RUN printf 'Server = https://archive.archlinux.org/repos/2026/11/18/$repo/os/$arch\n' > /etc/pacman.d/mirrorlist \
    && set -- \
    ghostty foot konsole gnome-terminal xfce4-terminal terminator rio contour vulkan-swrast \
    xorg-server-xvfb xorg-xwininfo dbus mesa ttf-dejavu nodejs python sway procps-ng \
    && for attempt in 1 2 3; do \
        timeout --kill-after=30s 5m pacman -Syyuuw --noconfirm --needed --disable-download-timeout "$@" && break; \
        [ "$attempt" -lt 3 ] || exit 1; \
        find /var/cache/pacman/pkg -mindepth 2 -maxdepth 2 -type f -name '*.pkg.tar.*' -exec mv -t /var/cache/pacman/pkg -- {} + || exit 1; \
        rm -f /var/lib/pacman/db.lck; \
        sleep $((attempt * 15)); \
    done \
    && pacman -Suu --noconfirm --needed "$@" \
    && if [ -n "$(getcap /usr/bin/sway)" ]; then setcap -r /usr/bin/sway; fi \
    && useradd -m -u 1000 titlewave \
    && rm -rf /var/cache/pacman/pkg/*
WORKDIR /work
RUN chown titlewave:titlewave /work
COPY --chown=titlewave:titlewave package.json ./
COPY --chown=titlewave:titlewave bin ./bin
COPY --chown=titlewave:titlewave lib ./lib
COPY --chown=titlewave:titlewave test/desktop-terminals.py ./test/desktop-terminals.py
COPY --chown=titlewave:titlewave test/restore-title.mjs ./test/restore-title.mjs
USER titlewave
CMD ["bash", "-c", "python test/desktop-terminals.py && TITLEWAVE_TEST_RESUME=1 python test/desktop-terminals.py"]
