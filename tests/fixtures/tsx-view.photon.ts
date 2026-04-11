/**
 * Test photon with TSX view file
 * @ui dashboard ./ui/dashboard.tsx
 */
export default class TsxViewPhoton {
  /**
   * Returns sample dashboard data
   * @ui dashboard
   */
  async dashboard() {
    return {
      title: 'TSX Dashboard',
      items: [
        { name: 'Users', count: 42 },
        { name: 'Orders', count: 128 },
        { name: 'Revenue', count: 9400 },
      ],
    };
  }
}
