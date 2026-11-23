// Each host owns its sequence so repeated decorative SVGs have distinct IDs.
export function createGameArtwork() {
  let artworkCount = 0;
  function art(id) {
    const gradientId = `bret-sky-${++artworkCount}`;
    const base = `<svg viewBox="0 0 480 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${gradientId}" x2="0" y2="1"><stop stop-color="${id === "firefly" ? "#b9acd1" : id === "moles" ? "#e5ebdb" : id === "order" ? "#f1e7dd" : "#ded8ed"}"/><stop offset="1" stop-color="${id === "firefly" ? "#e7d9e7" : "#f5eef7"}"/></linearGradient></defs><path fill="url(#${gradientId})" d="M0 0h480v240H0z"/><circle cx="372" cy="57" r="31" fill="#fff1cf"/>`;
    let body = "";
    if (id === "moles") {
      body =
        '<path d="M0 145Q120 98 250 150T480 133V240H0Z" fill="#a4b49b"/><path d="M0 192Q180 139 480 194V240H0Z" fill="#829a82"/>';
      for (const [x, y, s] of [
        [120, 154, 0.7],
        [240, 188, 1],
        [356, 151, 0.75],
      ])
        body += `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cy="26" rx="48" ry="12" fill="#637b68"/><path d="M-29 26v-29q0-33 29-33T29-3v29" fill="#b39079"/><ellipse cx="-27" cy="-10" rx="10" ry="13" fill="#b39079"/><ellipse cx="27" cy="-10" rx="10" ry="13" fill="#b39079"/><circle cx="-10" cy="-7" r="3" fill="#433346"/><circle cx="10" cy="-7" r="3" fill="#433346"/><ellipse cy="4" rx="7" ry="5" fill="#ebc6ae"/><path d="M-6 15q6 6 12 0" stroke="#674b52" fill="none" stroke-width="2"/><path d="M0 36v-20m0 7q-17-1-15-15 15 1 15 15m0-2q1-16 14-15 1 14-14 15" fill="#d7e3ba" stroke="#617b5d" stroke-width="2"/></g>`;
    }
    if (id === "firefly") {
      body =
        '<path d="M0 140Q140 77 275 160T480 126V240H0Z" fill="#a293ba"/><path d="M0 199Q140 134 480 202V240H0Z" fill="#7c6a99"/><path d="M35 240Q125 178 252 192T418 108" stroke="#efdcbd" fill="none" stroke-width="17"/>';
      for (const [x, y] of [
        [90, 120],
        [168, 90],
        [275, 132],
        [342, 93],
        [395, 158],
      ])
        body += `<circle cx="${x}" cy="${y}" r="10" fill="#fff1be" opacity=".25"/><circle cx="${x}" cy="${y}" r="3" fill="#fff5d2"/>`;
      body +=
        '<ellipse cx="240" cy="133" rx="18" ry="10" fill="#ebe4f8" transform="rotate(-30 240 133)"/><ellipse cx="267" cy="133" rx="18" ry="10" fill="#ebe4f8" transform="rotate(30 267 133)"/><ellipse cx="253" cy="146" rx="8" ry="15" fill="#fff1a9"/><circle cx="253" cy="132" r="7" fill="#604c77"/>';
    }
    if (id === "order") {
      body =
        '<path d="M105 28h270v181H105z" fill="#f8f2e7"/><path d="M123 42h87v104h-87z" fill="#bcd6d4"/><path d="M166 42v104m-43-52h87" stroke="#faf6ec" stroke-width="7"/><path d="M75 190h330v15H75z" fill="#b99983"/><path d="M105 205v35m270-35v35" stroke="#ab8c79" stroke-width="10"/><path d="M252 190v-66m-25 5h50l-9-47h-32z" fill="#aa92bd" stroke="#aa92bd" stroke-width="5"/><path d="M135 166h35l-5 24h-25z" fill="#c59a80"/><path d="M151 167v-42m0 20q-22-2-19-24 22 1 19 24m0-9q1-27 24-26 1 24-24 26" fill="#8daa88" stroke="#739771" stroke-width="2"/><path d="M290 180h52v10h-52z" fill="#829b9a"/><path d="M295 167h42v13h-42z" fill="#d5b99f"/><path d="M200 171h22v19h-22z" fill="#e2c9bf"/><path d="M222 175q15-2 10 9h-10" fill="none" stroke="#e2c9bf" stroke-width="5"/>';
    }
    if (id === "landscape") {
      body =
        '<path d="M0 148 130 48l114 106 88-71 148 90V240H0Z" fill="#b5accb"/><path d="m85 85 45-37 51 47-47-14-18 14Z" fill="#eee8f5"/><path d="M0 174q110-39 213 0t267-10v76H0Z" fill="#8da7a1"/><path d="M0 204q151-32 480 3v33H0Z" fill="#bad4d0"/><path d="M0 239q130-44 240-14t240-2" fill="none" stroke="#dbe7e2" stroke-width="8"/><path d="M282 45h100v105H282z" fill="#eee8f5" opacity=".75"/><path d="m307 70 15 26h-30Z" fill="#997dad"/><path d="m351 71 15 26h-30Z" fill="#997dad"/><circle cx="304" cy="119" r="8" fill="#b4c9a4"/><circle cx="327" cy="119" r="8" fill="#b4c9a4"/><circle cx="350" cy="119" r="8" fill="#b4c9a4"/>';
    }
    return base + body + "</svg>";
  }
  return art;
}
