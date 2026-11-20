FROM archlinux@sha256:d4594bb2300cba11f41c2f27923eb56f63d9988909c402f9c95517d1e362c899
RUN printf 'Server = https://archive.archlinux.org/repos/2026/11/18/$repo/os/$arch\n' > /etc/pacman.d/mirrorlist \
    && pacman -Syyuu --noconfirm --needed \
    ghostty foot konsole gnome-terminal xfce4-terminal terminator rio contour vulkan-swrast \
    xorg-server-xvfb xorg-xwininfo dbus mesa ttf-dejavu nodejs python sway \
    && if [ -n "$(getcap /usr/bin/sway)" ]; then setcap -r /usr/bin/sway; fi \
    && useradd -m -u 1000 titlewave \
    && yes | pacman -Scc
WORKDIR /work
RUN chown titlewave:titlewave /work
COPY --chown=titlewave:titlewave package.json ./
COPY --chown=titlewave:titlewave bin ./bin
COPY --chown=titlewave:titlewave lib ./lib
COPY --chown=titlewave:titlewave test/desktop-terminals.py ./test/desktop-terminals.py
USER titlewave
CMD ["python", "test/desktop-terminals.py"]
