const links = document.querySelectorAll("[data-download]");

for (const link of links) {
  link.addEventListener("click", () => {
    const original = link.textContent;
    link.textContent = "Download started";
    window.setTimeout(() => {
      link.textContent = original;
    }, 2400);
  });
}
