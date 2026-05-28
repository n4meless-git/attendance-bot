require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // [기존 정각 알림 스케줄러]
    cron.schedule('0 * * * *', async () => {
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const today = kstDate.toISOString().split('T')[0];
        const currentHour = kstDate.getUTCHours();

        const messageText = getRemindMessage(currentHour);
        
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) { console.error(`${user.username} DM 전송 실패`); }
                    }
                }
            }
        }
    });

    // 🚨 [새로 추가] 매일 밤 23시 59분에 출근 안 한 사람 보호권 차감 및 초기화 스케줄러
    cron.schedule('59 23 * * *', async () => {
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const today = kstDate.toISOString().split('T')[0];

        const { data: allUsers } = await supabase.from('attendance').select('*');
        if (!allUsers) return;

        for (const user of allUsers) {
            // 오늘 출근을 안 한 경우
            if (user.last_checkin !== today && (user.streak || 0) > 0) {
                let cards = user.protection_cards || 0;
                
                if (cards > 0) {
                    // 보호권이 있으면 1개 차감하고 스트릭 유지
                    cards -= 1;
                    await supabase
                        .from('attendance')
                        .update({ protection_cards: cards })
                        .eq('user_id', user.user_id);
                    
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`🛡️ 오늘 출근하지 않았지만, **출근 횟수 보호권**이 사용되어 연속 출근 기록이 유지되었습니다! (남은 보호권: ${cards}개)`);
                    } catch (e) {}
                } else {
                    // 보호권이 없으면 스트릭 초기화
                    await supabase
                        .from('attendance')
                        .update({ streak: 0 })
                        .eq('user_id', user.user_id);

                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`💀 보호권이 없어 오늘 자로 연속 출근 횟수가 초기화되었습니다. 내일부터 다시 힘내세요!`);
                    } catch (e) {}
                }
            }
        }
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];
    const currentHour = kstDate.getUTCHours();

    // 1. 듀오링고 테스트 로직
    if (message.content === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다. (정기 알림 대기 중)`;

        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            return message.reply("성공! 개인 DM을 확인해보세요. 📩");
        } catch (err) {
            return message.reply("DM 전송에 실패했습니다. 설정을 확인해 보세요!");
        }
    }

    // 🚨 2. 토큰 상점 로직 (!상점)
    if (message.content === "!상점") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const myTokens = user ? (user.tokens ?? 200) : 200;
            const myCards = user ? (user.protection_cards ?? 0) : 0;

            return message.reply(`🛒 **토큰 상점에 오신 것을 환영합니다!**\n\n` +
                                `👤 **내 정보**\n` +
                                `└ 보유 토큰: 💰 \`${myTokens} 토큰\`\n` +
                                `└ 보유 보호권: 🛡️ \`${myCards} 개\`\n\n` +
                                `📦 **판매 상품**\n` +
                                `└ 🛡️ **출근 횟수 보호권** | 가격: \`100 토큰\`\n` +
                                `   *하루 결근 시 자동으로 사용되어 연속 출근 기록을 지켜줍니다.*\n\n` +
                                `👉 구매하려면 \`!구매 보호권\` 을 입력하세요!`);
        } catch (err) {
            return message.reply("상점을 불러오는 중 오류가 발생했습니다.");
        }
    }

    // 🚨 3. 보호권 구매 로직 (!구매 보호권)
    if (message.content === "!구매 보호권") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentTokens < 100) {
                return message.reply(`❌ 토큰이 부족합니다! (현재 보유: 💰 \`${currentTokens} 토큰\`)`);
            }

            currentTokens -= 100;
            currentCards += 1;

            // 데이터가 아예 없는 신규 유저가 상점부터 이용할 경우를 대비해 upsert 처리
            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: currentTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            return message.reply(`🛒 구매 완료! **출근 횟수 보호권** 1개를 획득했습니다. (잔여 토큰: 💰 \`${currentTokens}\` | 보유 보호권: 🛡️ \`${currentCards}개\`)`);
        } catch (err) {
            console.error(err);
            return message.reply("구매 처리 중 오류가 발생했습니다.");
        }
    }

    // 4. 출근 인정 단어 목록
    const allowedKeywords = [
        "출근", "근출", "출", "근", "出勤", "ㅊㄱ", "출첵", "출석", "attend", 
        "근.", "출.", "출 ", "근 ", "출군", "앙", "아잉", "웅", "출근해떠염", 
        "여자", "ㅊㅊ", "시기다른래퍼들의반대편을바라보던래퍼들의배포"
    ];

    if (!allowedKeywords.includes(message.content)) return;

    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 **지금은 출근 금지 시간입니다!**\n상쾌한 아침 공기를 마시며 다시 와주세요! 😴");
    }

    try {
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(오늘 날짜: ${today})`);
        }

        // 🚨 [새로 추가] 출근 시간대에 따른 토큰 지급액 결정
        let earnedTokens = 10; // 기본 23시까지는 10토큰
        if (currentHour < 14) {
            earnedTokens = 20; // 14시 전까지 20토큰
        } else if (currentHour < 18) {
            earnedTokens = 15; // 18시 전까지 15토큰
        }

        let newStreak = 1;
        if (user && user.last_checkin) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        // 기존 토큰에 새로 번 토큰 더하기 (기본값 200 보유 가정)
        const totalTokens = (user ? (user.tokens ?? 200) : 200) + earnedTokens;
        const currentCards = user ? (user.protection_cards ?? 0) : 0;

        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: message.author.username,
                last_checkin: today,
                streak: newStreak,
                tokens: totalTokens,
                protection_cards: currentCards
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;
        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥\n💰 \`${earnedTokens} 토큰\` 획득! (총 보유: \`${totalTokens} 토큰\`)`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ DB 처리 오류 발생!");
    }
});

client.login(process.env.DISCORD_TOKEN);
