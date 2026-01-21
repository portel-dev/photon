/**
 * Test Custom UI
 * 
 * @ui main-ui ./test-ui/test-ui.html
 */
export default class TestCustomUI {

    /**
     * @ui main-ui
     */
    async main() {
        return { message: "This text should be replaced by the custom UI" };
    }

    async ping(args: any) {
        return { message: "Pong from Photon!", received: args };
    }
}
