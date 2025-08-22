const fetch = require("node-fetch");

async function verifyPayment() {
  const response = await fetch(`https://checkout.dodopayments.com/payments/pdt_7or034UBldrgQUgpszH3d`, {
    method: "GET",
    headers: {
      Authorization: `Bearer SfU-Bh7r7KCeB898.ccvQedY8lOLfyv1WiCBVVLwSczf9flR5IxxQwl6-mKE-OK_E`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Error verifying payment: ${response.statusText}`);
  }

  const data = await response.json();
  return data.status === "succeeded";
}


verifyPayment()
