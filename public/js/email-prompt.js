const checkbox = document.getElementById("checkbox");
const emailInput = document.getElementById("email-input");
if (checkbox && emailInput) {
  checkbox.addEventListener("change", () => {
    emailInput.hidden = !checkbox.checked;
  });
}
