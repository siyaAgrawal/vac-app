import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        let nav = UINavigationController(rootViewController: HomeViewController())
        nav.navigationBar.barStyle          = .black
        nav.navigationBar.tintColor         = UIColor(red: 0.20, green: 0.60, blue: 1.00, alpha: 1)
        nav.navigationBar.titleTextAttributes = [
            .foregroundColor: UIColor.white,
            .font: UIFont.systemFont(ofSize: 17, weight: .bold),
        ]
        nav.navigationBar.largeTitleTextAttributes = [
            .foregroundColor: UIColor.white,
        ]
        if #available(iOS 13.0, *) {
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = UIColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1)
            appearance.titleTextAttributes        = [.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 17, weight: .bold)]
            appearance.largeTitleTextAttributes   = [.foregroundColor: UIColor.white]
            nav.navigationBar.standardAppearance  = appearance
            nav.navigationBar.scrollEdgeAppearance = appearance
            nav.navigationBar.compactAppearance   = appearance
        }
        window?.rootViewController = nav
        window?.makeKeyAndVisible()
        return true
    }
}
