import React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './PrivacyPolicyScreen.Styles';

type Props = NativeStackScreenProps<RootStackParamList, 'PrivacyPolicyScreen'>;

function PrivacyPolicyScreen({ navigation }: Props) {
    const handleOpenCookiePolicy = () => {
        void Linking.openURL('https://forkfriends.github.io/');
    };

    const handleOpenCookieYes = () => {
        void Linking.openURL(
        'https://www.cookieyes.com/?utm_source=PP&utm_medium=footer&utm_campaign=UW',
        );
    };

    return (
        <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text style={styles.title}>Privacy Policy</Text>
            <Text style={[styles.subtitle, styles.subtitleSpacing]}>
                Last Updated On 17-Nov-2025
            </Text>
            <Text style={[styles.subtitle, styles.subtitleSpacing]}>
                Effective Date 17-Nov-2025
            </Text>

            <Text style={styles.paragraph}>
                {`This Privacy Policy describes the policies of ForkFriends, 801 Atlantic Drive NW, GA 30332, United States of America (the), email: eth4n007@gmail.com, phone: 4703015218 on the collection, use and disclosure of your information that we collect when you use our website ( https://forkfriends.github.io/ ). (the “Service”). By accessing or using the Service, you are consenting to the collection, use and disclosure of your information in accordance with this Privacy Policy. If you do not consent to the same, please do not access or use the Service.`}
            </Text>

            <Text style={styles.paragraph}>
                {`We may modify this Privacy Policy at any time without any prior notice to you and will post the revised Privacy Policy on the Service. The revised Policy will be effective 180 days from when the revised Policy is posted in the Service and your continued access or use of the Service after such time will constitute your acceptance of the revised Privacy Policy. We therefore recommend that you periodically review this page.`}
            </Text>

            <View style={styles.section}>
                <Text style={styles.sectionHeading}>HOW WE SHARE YOUR INFORMATION:</Text>

                <Text style={styles.paragraph}>
                {`We will not transfer your personal information to any third party without seeking your consent, except in limited circumstances as described below:`}
                </Text>

                <View style={styles.bulletList}>
                <Text style={styles.bulletItem}>• Ad service</Text>
                <Text style={styles.bulletItem}>• Analytics</Text>
                </View>

                <Text style={styles.paragraph}>
                {`We require such third party’s to use the personal information we transfer to them only for the purpose for which it was transferred and not to retain it for longer than is required for fulfilling the said purpose.`}
                </Text>

                <Text style={styles.paragraph}>
                {`We may also disclose your personal information for the following: (1) to comply with applicable law, regulation, court order or other legal process; (2) to enforce your agreements with us, including this Privacy Policy; or (3) to respond to claims that your use of the Service violates any third-party rights. If the Service or our company is merged or acquired with another company, your information will be one of the assets that is transferred to the new owner.`}
                </Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionHeading}>YOUR RIGHTS:</Text>

                <Text style={styles.paragraph}>
                {`Depending on the law that applies, you may have a right to access and rectify or erase your personal data or receive a copy of your personal data, restrict or object to the active processing of your data, ask us to share (port) your personal information to another entity, withdraw any consent you provided to us to process your data, a right to lodge a complaint with a statutory authority and such other rights as may be relevant under applicable laws. To exercise these rights, you can write to us at eth4n007@gmail.com. We will respond to your request in accordance with applicable law.`}
                </Text>

                <Text style={styles.paragraph}>
                {`Do note that if you do not allow us to collect or process the required personal information or withdraw the consent to process the same for the required purposes, you may not be able to access or use the services for which your information was sought.`}
                </Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionHeading}>COOKIES ETC.</Text>

                <Text style={styles.paragraph}>
                {`To learn more about how we use these and your choices in relation to these tracking technologies, please refer to our `}
                <Text style={styles.link} onPress={handleOpenCookiePolicy}>
                    Cookie Policy.
                </Text>
                </Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionHeading}>SECURITY:</Text>

                <Text style={styles.paragraph}>
                {`The security of your information is important to us and we will use reasonable security measures to prevent the loss, misuse or unauthorized alteration of your information under our control. However, given the inherent risks, we cannot guarantee absolute security and consequently, we cannot ensure or warrant the security of any information you transmit to us and you do so at your own risk.`}
                </Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionHeading}>GRIEVANCE / DATA PROTECTION OFFICER:</Text>

                <Text style={styles.paragraph}>
                {`If you have any queries or concerns about the processing of your information that is available with us, you may email our Grievance Officer at ForkFriends, 801 Atlantic Drive NW, email: eth4n007@gmail.com. We will address your concerns in accordance with applicable law.`}
                </Text>
            </View>

          <Text style={styles.paragraph}>
            {`Privacy Policy generated with `}
            <Text style={styles.link} onPress={handleOpenCookieYes}>
              CookieYes
            </Text>
            {`.`}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

export default PrivacyPolicyScreen;
