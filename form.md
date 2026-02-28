    <form method="post" action="https://sandbox.moncashbutton.digicelgroup.com/Moncash-middlewareTest/Checkout/{BusinessKey}" >
        <input type="hidden" name="amount" value="base64(encrypt(Amount for this order))"/>
        <input type="hidden" name="orderId" value="base64(encrypt(Order Id))"/>
        <input type="image" name="ap_image" src="https://sandbox.moncashbutton.digicelgroup.com/Moncash-middlewareTest/resources/assets/images/MC_button.png"/>
    </form>